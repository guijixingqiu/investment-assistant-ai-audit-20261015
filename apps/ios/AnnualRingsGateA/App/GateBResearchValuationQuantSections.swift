import SwiftUI

enum ValuationInputField: Int, CaseIterable, Hashable {
    case metricCurrency
    case baseMetric
    case growth
    case horizon
    case multiple
    case discount
    case netCash
    case growthStep
    case multipleStep
    case maxDrawdown
    case maxTurnover
    case minTradeCount
    var next: ValuationInputField? { Self(rawValue: rawValue + 1) }
}

extension GateBResearchScreen {
    @ViewBuilder
    func valuationQuantCandidateAction(_ membership: CandidateMembershipData) -> some View {
        Button {
            selectMembershipForAction(membership, layer: .evidence)
            selectedEvidenceWorkspace = .valuation
            pendingDecisionWorkspaceScrollTarget = "annualValuationQuantAnchor"
        } label: {
            Label("打开估值与量化", systemImage: "function")
        }
        .buttonStyle(.bordered)
        .disabled(membership.state == .archived)
        .accessibilityIdentifier("annualValuationQuantOpen-\(membership.symbol)")
    }

    @ViewBuilder
    func annualValuationQuantSection() -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("历史策略回测")
                .accessibilityIdentifier("annualValuationQuantTitle")
            if let message = valuationQuantInputMessage, !isLoadingValuationQuant {
                Text(message).font(.footnote).foregroundStyle(.red)
            }
            Text("复算估值使用你填写的假设。历史策略回测目前支持吉利汽车和腾讯，使用已有冻结历史样本；重新运行不会更新样本日期，也不会下单。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualValuationQuantRunHint")

            Button {
                guard let membership = selectedMembership else { return }
                Task { await runRegisteredAnnualValuationQuant(for: membership) }
            } label: {
                Label(isLoadingValuationQuant ? "回测运行中" : "运行历史策略回测", systemImage: "play.circle")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingValuationQuant || selectedMembership == nil || selectedMembership?.state == .archived)
            .disabled(!["HK.00175", "HK.00700"].contains(selectedMembership?.symbol ?? "") || AppEnvironment.writeAuthToken() == nil)
            .accessibilityIdentifier("annualValuationQuantRunButton")
            if !["HK.00175", "HK.00700"].contains(selectedMembership?.symbol ?? "") {
                Text("这家公司尚未配置可运行的历史策略；估值情景仍可使用。")
                    .font(.caption).foregroundStyle(.secondary)
            } else if AppEnvironment.writeAuthToken() == nil {
                Text("运行回测需要研究写入授权，请检查连接设置。")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if let intake = registeredQuantIntake,
               intake.status == .available,
               let context = intake.decisionContext {
                registeredQuantEvidence(context.quantEvidence)
            }

            DisclosureGroup("估值假设与情景复算（可选）") {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("估值与量化检视")
                    .accessibilityIdentifier("annualValuationQuantTitle")
                Spacer()
                Text(valuationQuantStatusLabel(valuationQuantEnvelope.data?.valuation.status ?? valuationQuantEnvelope.status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(valuationQuantEnvelope.data == nil ? Color.secondary : Color.blue)
                    .accessibilityIdentifier("annualValuationQuantStatus")
            }

            if valuationQuantEnvelope.data == nil {
                Text(valuationQuantEnvelope.message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualValuationQuantFailClosed")
            }


            valuationInputs()
            quantFilterInputs()

            if let valuationQuantInputMessage {
                Text(valuationQuantInputMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualValuationQuantInputMessage")
            }

            Button {
                guard let membership = selectedMembership else { return }
                Task { await loadAnnualValuationQuant(for: membership) }
            } label: {
                Label(isLoadingValuationQuant ? "复算中" : "复算用户情景", systemImage: "function")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoadingValuationQuant || selectedMembership == nil || selectedMembership?.state == .archived)
            .accessibilityIdentifier("annualValuationQuantLoadButton")

            if let data = valuationQuantEnvelope.data {
                valuationIdentity(data)
                valuationResult(data.valuation)
                quantProductResult(data.quant)
            }

            }

            InfoBlock(
                title: "边界",
                value: "所有估值假设和筛选条件均由用户输入；结果不是系统目标价、评分、排序、推荐、仓位、方向或交易动作。",
                valueIdentifier: "annualValuationQuantSafety"
            )
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onChange(of: valuationQuantDraft) { oldValue, newValue in
            guard oldValue != newValue else { return }
            clearAnnualValuationQuant(
                message: "用户输入已变化；旧估值与量化结果已清除。",
                membershipId: selectedMembership?.id,
                clearDraft: false
            )
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                if let next = focusedValuationInput?.next {
                    Button {
                        focusedValuationInput = next
                    } label: {
                        Image(systemName: "arrow.down.to.line")
                    }
                    .accessibilityLabel("下一项")
                    .accessibilityIdentifier("valuationKeyboardNextButton")
                }
                Button {
                    focusedValuationInput = nil
                } label: {
                    Image(systemName: "keyboard.chevron.compact.down")
                }
                .accessibilityLabel("收起键盘")
                .accessibilityIdentifier("valuationKeyboardDismissButton")
            }
        }
        .id("annualValuationQuantAnchor")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualValuationQuantSection")
    }

    private func valuationQuantStatusLabel(_ value: String) -> String {
        switch value {
        case "available": "已计算"
        case "stale": "需要刷新"
        case "missing": "输入待补"
        case "conflict": "数据冲突"
        default: "尚未计算"
        }
    }

    private func valuationInputs() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Owner 方法与估值假设")
                .font(.callout.weight(.semibold))
            Picker("估值方法", selection: $valuationQuantDraft.methodId) {
                Text("远期指标倍数法").tag("discounted_forward_metric_multiple_user_scenario")
                Text("调整后净资产价值法").tag("adjusted_net_asset_value_user_scenario")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("annualValuationMethodPicker")
            Text(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario"
                ? "仅当公司披露的资产负债表事实适合净资产口径时选择；你明确确认每股净资产、实现率和调整项。"
                : "仅当公司披露的收入或归母利润适合远期每股指标口径时选择；你明确确认增长、倍数和折现假设。")
                .font(.caption)
                .foregroundStyle(.secondary)
            valuationField("估值币种", text: $valuationQuantDraft.metricCurrency, identifier: "valuationMetricCurrencyField", focus: .metricCurrency, currency: true)
            valuationField(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario" ? "基础净资产/股" : "基础每股指标", text: $valuationQuantDraft.baseMetricPerShare, identifier: "valuationBaseMetricField", focus: .baseMetric)
            valuationField(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario" ? "净资产年变动率 %" : "年增长率 %", text: $valuationQuantDraft.annualGrowthPercent, identifier: "valuationGrowthField", focus: .growth)
            valuationField("观察年限", text: $valuationQuantDraft.horizonYears, identifier: "valuationHorizonField", focus: .horizon, integer: true)
            valuationField(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario" ? "资产实现率 %（10–100）" : "期末倍数", text: $valuationQuantDraft.terminalMultiple, identifier: "valuationMultipleField", focus: .multiple)
            valuationField("年折现率 %", text: $valuationQuantDraft.annualDiscountPercent, identifier: "valuationDiscountField", focus: .discount)
            valuationField(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario" ? "资产负债调整/股" : "每股净现金", text: $valuationQuantDraft.netCashPerShare, identifier: "valuationNetCashField", focus: .netCash)
            valuationField("增长敏感性步长 %", text: $valuationQuantDraft.growthStepPercent, identifier: "valuationGrowthStepField", focus: .growthStep)
            valuationField(valuationQuantDraft.methodId == "adjusted_net_asset_value_user_scenario" ? "实现率步长（百分点，乐观情景≤100%）" : "倍数敏感性步长", text: $valuationQuantDraft.multipleStep, identifier: "valuationMultipleStepField", focus: .multipleStep)
        }
    }

    private func quantFilterInputs() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("用户量化筛选")
                .font(.callout.weight(.semibold))
            valuationField("最大回撤 %", text: $valuationQuantDraft.maxDrawdownPercent, identifier: "quantMaxDrawdownField", focus: .maxDrawdown)
            valuationField("最大单边换手 %", text: $valuationQuantDraft.maxTurnoverPercent, identifier: "quantMaxTurnoverField", focus: .maxTurnover)
            valuationField("最少模拟交易", text: $valuationQuantDraft.minTradeCount, identifier: "quantMinTradeCountField", focus: .minTradeCount, integer: true)
        }
    }

    private func valuationField(
        _ title: String,
        text: Binding<String>,
        identifier: String,
        focus: ValuationInputField,
        integer: Bool = false,
        currency: Bool = false
    ) -> some View {
        LabeledContent(title) {
            TextField(title, text: text)
                .multilineTextAlignment(.trailing)
                .keyboardType(currency ? .asciiCapable : integer ? .numberPad : .decimalPad)
                .textInputAutocapitalization(currency ? .characters : .never)
                .autocorrectionDisabled(currency)
                .focused($focusedValuationInput, equals: focus)
                .submitLabel(focus.next == nil ? .done : .next)
                .onSubmit { focusedValuationInput = focus.next }
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 96, maxWidth: 150)
                .accessibilityIdentifier(identifier)
        }
    }

    private func valuationIdentity(_ data: AnnualValuationQuantWorkbenchData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            InfoBlock(
                title: "候选身份",
                value: "\(data.target.symbol) / membership=\(data.target.membershipId) / version=\(data.target.membershipVersion) / \(data.target.membershipState)",
                valueIdentifier: "annualValuationQuantTarget"
            )
            InfoBlock(
                title: "决策上下文",
                value: "\(data.sourceIdentity.decisionContextId) / \(data.sourceIdentity.decisionContextHash)",
                valueIdentifier: "annualValuationQuantContext"
            )
        }
    }

    @ViewBuilder
    private func valuationResult(_ valuation: AnnualValuationResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("用户情景估值")
                .font(.callout.weight(.semibold))
            if let quote = valuation.quote, let outputs = valuation.outputs, let sensitivity = valuation.sensitivity {
                InfoBlock(
                    title: "Futu 报价",
                    value: "\(quote.price) \(quote.currency) / \(quote.quoteTime) / \(quote.snapshotId)",
                    valueIdentifier: "annualValuationQuote"
                )
                InfoBlock(
                    title: "用户研究情景现值",
                    value: "\(String(format: "%.6f", outputs.scenarioPresentValuePerShare)) \(valuation.inputs.metricCurrency ?? "币种未记录")",
                    valueIdentifier: "annualValuationPresentValue"
                )
                InfoBlock(
                    title: "当前价格隐含年增长",
                    value: outputs.impliedAnnualGrowthRateAtCurrentPrice.map { String(format: "%.2f%%", $0 * 100) } ?? "not_computable",
                    valueIdentifier: "annualValuationImpliedGrowth"
                )
                InfoBlock(
                    title: "复算方法",
                    value: "\(valuation.method.id) / \(valuation.method.calculationVersion) / \(valuation.method.applicability?.companyDataBasis ?? "legacy_unbound")",
                    valueIdentifier: "annualValuationMethod"
                )
                if let range = outputs.valueRange {
                    InfoBlock(
                        title: "三情景关注区间（研究用）",
                        value: "\(formatNumber(range.low))–\(formatNumber(range.high)) \(valuation.inputs.metricCurrency ?? "币种未记录")；不是目标价。",
                        valueIdentifier: "annualValuationValueRange"
                    )
                }
                if let margin = outputs.scenarioMarginOfSafety {
                    InfoBlock(
                        title: "当前价格位置",
                        value: margin.position == "below_range" ? "低于 Owner 三情景区间" : margin.position == "above_range" ? "高于 Owner 三情景区间" : "位于 Owner 三情景区间内",
                        valueIdentifier: "annualValuationPricePosition"
                    )
                    InfoBlock(
                        title: "研究安全边际（低 / 基准 / 高）",
                        value: "\(String(format: "%.2f%%", margin.low * 100)) / \(String(format: "%.2f%%", margin.base * 100)) / \(String(format: "%.2f%%", margin.high * 100))；负值表示当前价格高于对应 Owner 情景价值，不是买卖信号。",
                        valueIdentifier: "annualValuationScenarioMargin"
                    )
                }
                valuationSensitivity(sensitivity, methodId: valuation.method.id)
            } else {
                Text(valuation.limitations.joined(separator: " "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualValuationUnavailable")
            }
            BulletList(title: "估值限制", items: valuation.limitations)
        }
    }

    private func valuationSensitivity(_ sensitivity: AnnualValuationSensitivity, methodId: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("敏感性")
                .font(.caption.weight(.semibold))
            ForEach(Array(sensitivity.cells.enumerated()), id: \.offset) { _, cell in
                Text("增长 \(String(format: "%.2f%%", cell.annualGrowthRate * 100)) · \(methodId == "adjusted_net_asset_value_user_scenario" ? "实现率 \(String(format: "%.2f%%", cell.terminalMultiple * 100))" : "倍数 \(formatNumber(cell.terminalMultiple))x") · 现值 \(formatNumber(cell.presentValuePerShare))")
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualValuationSensitivity")
    }

    /// Historical quant evidence published by the accepted registered run,
    /// rendered from the existing candidate decision-intake context so it never
    /// depends on a user valuation scenario or filter input.
    private func registeredQuantEvidence(_ evidence: DecisionQuantEvidence) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("历史回测已完成").font(.headline)
            Text("收益、回撤及费用仅对应原历史样本；重新运行不会将其变成当前市场预测。")
                .font(.caption).foregroundStyle(.secondary)
            if let refinement = evidence.decisionEvidence, refinement.status == "available" {
                ForEach(refinement.samples, id: \.id) { sample in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(["train": "训练期", "validation": "验证期", "final_test": "保留测试期"][sample.id] ?? sample.id).font(.headline)
                        Text("\(sample.start) 至 \(sample.end)").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Text("模拟收益  " + String(format: "%.2f%%", sample.metrics.simulatedTotalReturn * 100))
                            Spacer()
                            Text("最大回撤  " + String(format: "%.2f%%", sample.metrics.simulatedMaxDrawdown * 100))
                        }.font(.subheadline).monospacedDigit()
                        Text("模拟执行 \(sample.metrics.simulatedTradeCount) 次 · 费用 " + String(format: "%.2f 港元", sample.metrics.simulatedTotalFees))
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(12).background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            quantExperimentComparison(evidence.comparison)
            DisclosureGroup("执行规则、证据与样本限制") {
                InfoBlock(title: "完整样本指标", value: quantDecisionEvidenceSamples(evidence),
                    valueIdentifier: "annualQuantRegisteredSamples")
                InfoBlock(title: "研究身份与观察期", value: quantDecisionEvidenceSummary(evidence),
                    valueIdentifier: "annualQuantRegisteredSummary")
                InfoBlock(title: "T+1、成本与整手", value: quantDecisionEvidenceExecution(evidence),
                    valueIdentifier: "annualQuantRegisteredExecution")
                InfoBlock(title: "稳健性与失败实验", value: quantDecisionEvidenceRobustness(evidence),
                    valueIdentifier: "annualQuantRegisteredRobustness")
                BulletList(title: "正式量化证据完整性", items: quantFormalEvidenceChecks(evidence))
                BulletList(title: "样本限制与实验比较", items: evidence.limitations + [evidence.sampleBoundary.limitation])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualQuantRegisteredEvidence")
    }

    private func quantProductResult(_ quant: AnnualQuantProductView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("量化研究证据")
                .font(.callout.weight(.semibold))
            InfoBlock(
                title: "数据与模型身份",
                value: "snapshot=\(quant.model.snapshotId ?? "unavailable"); model/code=\(quant.model.modelVersion ?? "unavailable"); adjustment=\(quant.model.adjustment ?? "unavailable"); cutoff=\(quant.model.dataCutoff ?? "unavailable"); universe=\(quant.model.universe.joined(separator: ", "))",
                valueIdentifier: "annualQuantModelIdentity"
            )
            InfoBlock(title: "样本与指标", value: quantDecisionEvidenceSamples(quant.evidence), valueIdentifier: "annualQuantSamples")
            quantExperimentComparison(quant.evidence.comparison)
            if let universe = quant.evidence.identities?.hkConnectUniverse {
                InfoBlock(
                    title: "港股通股票池",
                    value: "\(universe.effectiveDate) · \(universe.memberCount) 只 · \(universe.snapshotId.prefix(12))",
                    valueIdentifier: "annualQuantHkConnectUniverse"
                )
                DisclosureGroup("完整来源与身份") {
                    Text("source=\(universe.source)")
                    Text("snapshotId=\(universe.snapshotId)")
                    Text("effectiveDate=\(universe.effectiveDate); capturedAt=\(universe.capturedAt); memberCount=\(universe.memberCount)")
                    ForEach(Array(universe.sourceUrls.enumerated()), id: \.offset) { index, sourceUrl in
                        if let url = URL(string: sourceUrl) {
                            Link("官方来源 \(index + 1)", destination: url)
                        }
                    }
                }
                .font(.caption)
                .accessibilityIdentifier("annualQuantHkConnectUniverseIdentity")
            }
            InfoBlock(title: "T+1、成本与整手", value: quantDecisionEvidenceExecution(quant.evidence), valueIdentifier: "annualQuantExecution")
            InfoBlock(title: "稳健性与失败实验", value: quantDecisionEvidenceRobustness(quant.evidence), valueIdentifier: "annualQuantRobustness")
            BulletList(title: "正式量化证据完整性", items: quantFormalEvidenceChecks(quant.evidence))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("annualQuantFormalEvidence")
            quantDiagnostics(quant.diagnostics)
            quantFilterResult(quant.filter)
            BulletList(title: "量化限制", items: quant.limitations)
        }
    }

    private func quantExperimentComparison(_ comparison: QuantExperimentComparison?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("固定基准与候选实验").font(.headline)
            if let comparison {
                Text("同一数据、参数登记窗口和费用口径 · \(comparison.selectionWindow.start) 至 \(comparison.selectionWindow.end)。按原登记顺序展示，不重新选赢家；保留测试期只作报告。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(Array(comparison.experiments.enumerated()), id: \.offset) { _, experiment in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(experiment.disposition == "selected" ? "固定基准" : "未选用实验") · \(experiment.id)")
                            .font(.subheadline.weight(.semibold))
                        Text("收益 \(String(format: "%.2f%%", experiment.metrics.totalReturn * 100)) · 最大回撤 \(String(format: "%.2f%%", experiment.metrics.maxDrawdown * 100))")
                            .font(.subheadline.monospacedDigit())
                        Text("费用 \(String(format: "%.2f", experiment.metrics.totalFees)) 港元 · 单边换手 \(String(format: "%.2f%%", experiment.metrics.turnoverOneWay * 100)) · 交易样本 \(experiment.metrics.tradeCount) 次 · 闭合交易 \(experiment.metrics.closedRoundTripCount) 次")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("原因：\(experiment.reason)").font(.caption)
                        Text("参数：前收盘回报 ≤ \(String(format: "%.2f%%", experiment.signal.buyWhenPreviousCloseReturnLte * 100)) 买入，≥ \(String(format: "%.2f%%", experiment.signal.sellWhenPreviousCloseReturnGte * 100)) 卖出")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(10).background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityIdentifier("annualQuantExperiment-\(experiment.id)")
                }
                Text("冻结清单记录交易次数与闭合交易数，未单列观察交易日数；不从日历估算样本量。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("同期恒生指数价格收益").font(.headline)
                ForEach(comparison.benchmark.periods, id: \.id) { period in
                    let periodName = ["train": "训练期", "validation": "验证期", "final_test": "保留测试期", "full_period": "全观察期"][period.id] ?? period.id
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(periodName) · \(period.start) 至 \(period.end)")
                            .font(.subheadline.weight(.semibold))
                        Text("策略模拟 \(String(format: "%.2f%%", period.simulatedStrategyTotalReturn * 100)) · 恒指价格 \(String(format: "%.2f%%", period.benchmarkTotalReturn * 100)) · 算术差 \(String(format: "%.2f", period.difference * 100)) 个百分点")
                            .font(.caption.monospacedDigit())
                    }
                    .accessibilityIdentifier("annualQuantBenchmark-\(period.id)")
                }
                Text("策略收益已计费用并含现金股息；恒指采用未调整收盘价的价格收益。差值仅是同期算术对照，口径不同，不代表超额收益或可据此选参。")
                    .font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("比较证据身份") {
                    Text("snapshot=\(comparison.snapshotId) · dataHash=\(comparison.dataHash)")
                    Text("实验登记=\(comparison.registryId) · 恒指来源=\(comparison.benchmark.evidenceId)")
                    Text("费用=\(comparison.feePolicySha256) · 股息=\(comparison.dividendCashPolicySha256)")
                }.font(.caption2)
            } else {
                Text("该证据没有完整、同口径且可校验的实验与恒指比较；旧清单或缺字段时不推算、不比较。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualQuantExperimentComparison")
    }

    private func quantDiagnostics(_ diagnostics: AnnualQuantDiagnostics) -> some View {
        let items = [
            "基准：\(diagnostics.benchmark.status) · \(diagnostics.benchmark.limitation)",
            "样本量：\(diagnostics.sampleSize.status) · \(diagnostics.sampleSize.limitation)",
            "集中度：\(diagnostics.concentration.status) · \(diagnostics.concentration.limitation)",
            "参数邻域：\(diagnostics.parameterNeighborhood.status) · \(diagnostics.parameterNeighborhood.limitation)",
            "市场环境：\(diagnostics.marketEnvironment.status) · \(diagnostics.marketEnvironment.limitation)",
            "失败实验：\(diagnostics.failedExperiments.status) · \(diagnostics.failedExperiments.experimentIds.joined(separator: ", ")) · \(diagnostics.failedExperiments.limitation)"
        ]
        return BulletList(title: "不可隐藏的诊断", items: items)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("annualQuantDiagnostics")
    }

    private func quantFilterResult(_ filter: AnnualQuantFilterResult) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("用户筛选结果（保持样本顺序）")
                .font(.caption.weight(.semibold))
            if filter.samples.isEmpty {
                Text(filter.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(filter.samples.enumerated()), id: \.offset) { _, sample in
                    Text("\(sample.sampleId)：回撤 \(String(format: "%.2f%%", sample.maxDrawdownMagnitude * 100)) · 换手 \(String(format: "%.2f%%", sample.turnoverOneWay * 100)) · 交易 \(sample.tradeCount) · 条件匹配 \(sample.allCriteriaMatched ? "是" : "否")")
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("annualQuantFilterSample-\(sample.sourceIndex)-\(sample.sampleId)")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualQuantFilterResults")
    }
}
