import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func annualPortfolioLabSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionTitle("组合情景与机会成本")
                    .accessibilityIdentifier("annualPortfolioLabTitle")
                Spacer()
                Text(portfolioLabEnvelope.data == nil ? (portfolioLabEnvelope.clientFailureState ?? portfolioLabEnvelope.status) : "available")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(portfolioLabEnvelope.data == nil ? .orange : .green)
                    .accessibilityIdentifier("annualPortfolioLabStatus")
            }

            TextField("用户金额，逗号分隔（HKD）", text: $portfolioLabAmountsInput)
                .keyboardType(.numbersAndPunctuation)
                .textFieldStyle(.roundedBorder)
                .focused($isPortfolioLabInputFocused)
                .accessibilityIdentifier("annualPortfolioLabAmountsInput")
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button {
                            isPortfolioLabInputFocused = false
                        } label: {
                            Image(systemName: "keyboard.chevron.compact.down")
                        }
                        .accessibilityLabel("收起情景金额键盘")
                        .accessibilityIdentifier("annualPortfolioLabKeyboardDone")
                    }
                }

            Button {
                isPortfolioLabInputFocused = false
                Task { await loadAnnualPortfolioLab() }
            } label: {
                Label(isLoadingPortfolioLab ? "读取中" : "并列比较用户情景", systemImage: "rectangle.split.3x1")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canLoadAnnualPortfolioLab)
            .accessibilityIdentifier("annualPortfolioLabRunButton")
            .accessibilityValue(annualPortfolioLabReadiness)

            Button {
                isPortfolioLabInputFocused = false
                Task { await loadPortfolioReportExplanation() }
            } label: {
                Label(
                    isLoadingPortfolioReportExplanation ? "解释读取中" : "解释当前报告的组合影响",
                    systemImage: "doc.text.magnifyingglass"
                )
            }
            .buttonStyle(.bordered)
            .disabled(!canLoadPortfolioReportExplanation)
            .accessibilityIdentifier("portfolioReportExplanationButton")

            Text(portfolioReportExplanationMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("portfolioReportExplanationMessage")

            if let data = portfolioReportExplanation?.data {
                portfolioReportExplanationResult(data)
            }

            if let portfolioLabMessage {
                Text(portfolioLabMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("annualPortfolioLabMessage")
            }

            if annualPortfolioLabNeedsQuoteRefresh {
                Button {
                    isPortfolioLabInputFocused = false
                    Task { await refreshAnnualPortfolioLabQuoteAndRetry() }
                } label: {
                    Label(isLoadingPortfolioLab ? "刷新中" : "刷新当前报价并重试", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(!canRefreshAnnualPortfolioLabQuote)
                .accessibilityIdentifier("annualPortfolioLabRefreshQuoteButton")

                Text("仅在这次明确点击后刷新当前候选报价；普通读取不会自动触发 provider 刷新。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let data = portfolioLabEnvelope.data {
                annualPortfolioLabIdentity(data)
                annualPortfolioLabScenarioGrid(data)
                annualPortfolioLabQuantEvidence(data.quant)
                crossStockPortfolioLabComparison(data)
                BulletList(title: "不可隐藏缺口", items: portfolioLabEnvelope.gaps)
            }

            Text("情景顺序完全由用户输入决定。现金、资金来源、行业和放弃收益均不推断；不生成优选情景、建议金额、目标权重、方向、股数或订单。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("annualPortfolioLabBoundary")
        }
        .id("annualPortfolioLabAnchor")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualPortfolioLabSection")
    }

    private func portfolioReportExplanationResult(
        _ data: PortfolioReportExplanationData
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("当前报告的组合影响")
                .accessibilityIdentifier("portfolioReportExplanationTitle")
            Text(data.holdings.candidate.status == .held
                ? "当前持有该标的；以下只说明当前权重、集中度及用户情景变化。"
                : "当前未持有该标的；以下只说明集中度及用户情景变化。")
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("portfolioReportExplanationConclusion")
            InfoBlock(
                title: "是否持有",
                value: data.holdings.candidate.status == .held ? "持有" : "未持有",
                valueIdentifier: "portfolioReportExplanationHeld"
            )
            InfoBlock(
                title: "当前候选权重",
                value: annualPortfolioLabPercent(data.holdings.candidate.weight),
                valueIdentifier: "portfolioReportExplanationWeight"
            )
            InfoBlock(
                title: "当前集中度",
                value: "最大仓位 \(annualPortfolioLabPercent(data.holdings.concentration.largestPositionWeight)) · 前三 \(annualPortfolioLabPercent(data.holdings.concentration.topThreeWeight)) · HHI \(annualPortfolioLabNumber(data.holdings.concentration.hhi))",
                valueIdentifier: "portfolioReportExplanationConcentration"
            )
            InfoBlock(
                title: "版本化量化风险",
                value: "港股通 \(data.quantRisk.hkConnectUniverse.effectiveDate) · \(data.quantRisk.hkConnectUniverse.memberCount) 只 · evidence \(data.quantRisk.evidenceId.suffix(12))",
                valueIdentifier: "portfolioReportExplanationQuantIdentity"
            )
            InfoBlock(
                title: "历史波动 / 压力 / 尾部",
                value: "\(annualPortfolioLabMetric(data.quantRisk.currentHistorical.annualizedVolatility, status: data.quantRisk.currentHistorical.status)) / \(annualPortfolioLabMetric(data.quantRisk.currentHistorical.historicalStressLossMagnitude, status: data.quantRisk.currentHistorical.status)) / \(annualPortfolioLabMetric(data.quantRisk.currentHistorical.historicalTailLossMagnitude, status: data.quantRisk.currentHistorical.status))",
                valueIdentifier: "portfolioReportExplanationHistoricalRisk"
            )
            InfoBlock(
                title: "候选风险贡献",
                value: annualPortfolioLabMetric(data.quantRisk.currentHistorical.candidateRiskContribution, status: data.quantRisk.currentHistorical.status),
                valueIdentifier: "portfolioReportExplanationRiskContribution"
            )
            InfoBlock(
                title: "相关性 / 流动性",
                value: "\(data.quantRisk.correlations.stability) · median turnover \(annualPortfolioLabNumber(data.quantRisk.candidateLiquidity.medianDailyTurnover)) · board lot \(data.quantRisk.candidateLiquidity.boardLot.map(String.init) ?? "not_captured")",
                valueIdentifier: "portfolioReportExplanationQuantMarketRisk"
            )
            ForEach(data.scenarios, id: \.scenarioId) { scenario in
                VStack(alignment: .leading, spacing: 4) {
                    Text("用户情景 \(annualPortfolioLabCurrency(scenario.userInputAmount))")
                        .font(.caption.weight(.semibold))
                    InfoBlock(title: "候选权重变化", value: annualPortfolioLabPercent(scenario.candidateWeightChange))
                    InfoBlock(title: "最大仓位变化", value: annualPortfolioLabPercent(scenario.largestPositionWeightChange))
                    InfoBlock(title: "HHI 变化", value: annualPortfolioLabNumber(scenario.hhiChange))
                    if let quant = data.quantRisk.scenarios.first(where: { $0.scenarioId == scenario.scenarioId }) {
                        InfoBlock(title: "历史波动变化", value: annualPortfolioLabMetric(quant.historical.annualizedVolatilityChange, status: quant.historical.status))
                        InfoBlock(title: "压力 / 尾部变化", value: "\(annualPortfolioLabMetric(quant.historical.historicalStressLossChange, status: quant.historical.status)) / \(annualPortfolioLabMetric(quant.historical.historicalTailLossChange, status: quant.historical.status))")
                        InfoBlock(title: "候选风险贡献变化", value: annualPortfolioLabMetric(quant.historical.candidateRiskContributionChange, status: quant.historical.status))
                    }
                }
                .padding(8)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("portfolioReportExplanationScenario-\(scenario.scenarioId)")
            }
            BulletList(
                title: "明确 UNKNOWN",
                items: [
                    "现金：\(data.unknowns.cash)",
                    "资金来源：\(data.unknowns.fundingSource)",
                    "行业：\(data.unknowns.sector)",
                    "机会成本：\(data.unknowns.opportunityCost)"
                ]
            )
            .accessibilityIdentifier("portfolioReportExplanationUnknowns")
            DisclosureGroup("来源身份") {
                VStack(alignment: .leading, spacing: 6) {
                    InfoBlock(title: "current report", value: "#\(data.binding.reportId) v\(data.binding.reportVersion) · \(data.binding.reportFingerprint)")
                    InfoBlock(title: "current pack", value: "#\(data.binding.evidencePackId) v\(data.binding.evidencePackVersion) · \(data.binding.evidencePackFingerprint)")
                    InfoBlock(title: "membership", value: "\(data.binding.membershipId) v\(data.binding.membershipVersion) · \(data.binding.symbol)")
                    InfoBlock(title: "组合 / 报价时点", value: "\(data.binding.portfolioAsOf) · \(data.binding.quote.quoteTime)")
                    InfoBlock(title: "量化窗口", value: "\(data.quantRisk.source.observationStartDate) 至 \(data.quantRisk.source.observationEndDate) · \(data.quantRisk.source.snapshotId)")
                }
                .padding(.top, 6)
            }
            .accessibilityIdentifier("portfolioReportExplanationIdentity")
            Text("只读解释；不推荐、不排名，不提供建议金额、目标权重、目标价或买卖方向，不写入报告、决定或组合。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("portfolioReportExplanationBoundary")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("portfolioReportExplanationResult")
    }

    private func annualPortfolioLabIdentity(_ data: AnnualPortfolioLabData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            InfoBlock(
                title: "候选绑定",
                value: "\(data.target.symbol) · membership \(data.target.membershipId) · version \(data.target.membershipVersion)",
                valueIdentifier: "annualPortfolioLabTarget"
            )
            InfoBlock(
                title: "当前事实",
                value: "Pingan \(data.sourceIdentity.portfolioAsOf) · Futu \(data.sourceIdentity.quote.quoteTime)",
                valueIdentifier: "annualPortfolioLabFactTime"
            )
            InfoBlock(
                title: "账户 / 快照",
                value: "\(data.sourceIdentity.accountScopeId) · \(data.sourceIdentity.portfolioSnapshotId)",
                valueIdentifier: "annualPortfolioLabSnapshotIdentity"
            )
            InfoBlock(title: "币种", value: data.dimensions.currency.currencies.joined(separator: ", "))
            InfoBlock(title: "行业", value: "not_captured（不按名称推断）")
        }
    }

    private func annualPortfolioLabScenarioGrid(_ data: AnnualPortfolioLabData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("当前与用户情景")
            annualPortfolioLabCurrentCard(data.current)
            ForEach(data.scenarios, id: \.scenarioId) { scenario in
                annualPortfolioLabScenarioCard(scenario)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualPortfolioLabScenarioGrid")
    }

    private func annualPortfolioLabCurrentCard(_ current: AnnualPortfolioLabCurrent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("当前基线")
                .font(.callout.weight(.semibold))
            InfoBlock(title: "组合市值", value: annualPortfolioLabCurrency(current.totalMarketValue))
            InfoBlock(title: "候选占比", value: annualPortfolioLabPercent(current.candidateWeight))
            InfoBlock(title: "最大仓位 / HHI", value: "\(annualPortfolioLabPercent(current.largestPositionWeight)) / \(annualPortfolioLabNumber(current.hhi))")
            InfoBlock(title: "历史波动", value: annualPortfolioLabMetric(current.historical.annualizedVolatility, status: current.historical.status))
            InfoBlock(title: "历史压力 / 尾部损失", value: "\(annualPortfolioLabMetric(current.historical.historicalStressLossMagnitude, status: current.historical.status)) / \(annualPortfolioLabMetric(current.historical.historicalTailLossMagnitude, status: current.historical.status))")
            InfoBlock(
                title: "候选风险贡献",
                value: annualPortfolioLabMetric(current.historical.candidateRiskContribution, status: current.historical.status),
                valueIdentifier: "annualPortfolioLabCurrentRiskContribution"
            )
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualPortfolioLabCurrent")
    }

    private func annualPortfolioLabScenarioCard(_ scenario: AnnualPortfolioLabScenario) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("用户情景 \(scenario.sourceIndex + 1)")
                .font(.callout.weight(.semibold))
            InfoBlock(title: "用户金额", value: annualPortfolioLabCurrency(scenario.hypotheticalAmount), valueIdentifier: "annualPortfolioLabScenarioAmount-\(scenario.sourceIndex)")
            InfoBlock(title: "候选占比", value: annualPortfolioLabPercent(scenario.riskImpact.scenario.candidateWeight), valueIdentifier: "annualPortfolioLabScenarioWeight-\(scenario.sourceIndex)")
            InfoBlock(title: "占比 / HHI 变化", value: "\(annualPortfolioLabPercent(scenario.comparison.candidateWeightChange)) / \(annualPortfolioLabNumber(scenario.comparison.hhiChange))")
            InfoBlock(title: "历史波动变化", value: annualPortfolioLabMetric(scenario.historical.annualizedVolatilityChange, status: scenario.historical.status))
            InfoBlock(title: "历史压力 / 尾部变化", value: "\(annualPortfolioLabMetric(scenario.historical.historicalStressLossChange, status: scenario.historical.status)) / \(annualPortfolioLabMetric(scenario.historical.historicalTailLossChange, status: scenario.historical.status))")
            InfoBlock(
                title: "候选风险贡献变化",
                value: annualPortfolioLabMetric(scenario.historical.candidateRiskContributionChange, status: scenario.historical.status),
                valueIdentifier: "annualPortfolioLabScenarioRiskContribution-\(scenario.sourceIndex)"
            )
            Text(scenario.comparison.opportunityCostLimitation)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualPortfolioLabScenario-\(scenario.sourceIndex)")
    }

    private func annualPortfolioLabQuantEvidence(_ quant: AnnualPortfolioLabQuantView) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle("历史量化研究层")
            InfoBlock(
                title: "精确覆盖",
                value: "\(quant.coverage.status) · 需要 \(quant.coverage.requiredSymbols.joined(separator: ", ")) · 缺失 \(quant.coverage.missingSymbols.joined(separator: ", ").isEmpty ? "无" : quant.coverage.missingSymbols.joined(separator: ", "))",
                valueIdentifier: "annualPortfolioLabQuantCoverage"
            )
            InfoBlock(
                title: "相关性窗口",
                value: "\(quant.correlations.status) · \(quant.correlations.observationStartDate ?? "unavailable") 至 \(quant.correlations.observationEndDate ?? "unavailable") · n=\(quant.correlations.observationCount.map(String.init) ?? "unavailable") · \(quant.correlations.stability)",
                valueIdentifier: "annualPortfolioLabCorrelationWindow"
            )
            if let universe = quant.evidence?.source.hkConnectUniverse {
                InfoBlock(
                    title: "港股通股票池",
                    value: "\(universe.effectiveDate) · \(universe.memberCount) 只 · \(universe.snapshotId.prefix(12))",
                    valueIdentifier: "annualPortfolioLabHkConnectUniverse"
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
                .accessibilityIdentifier("annualPortfolioLabHkConnectUniverseIdentity")
            }
            if let evidence = quant.evidence {
                DisclosureGroup("量化版本与执行边界") {
                    VStack(alignment: .leading, spacing: 6) {
                        InfoBlock(
                            title: "证据版本",
                            value: "\(evidence.schemaVersion) · \(evidence.evidenceId)",
                            valueIdentifier: "annualPortfolioLabQuantEvidenceIdentity"
                        )
                        InfoBlock(
                            title: "数据快照",
                            value: "\(evidence.source.snapshotId)\nsnapshot=\(evidence.source.snapshotHash)\ndata=\(evidence.source.dataHash)\ncutoff=\(evidence.source.dataCutoff) · \(evidence.source.sourceClassification) / \(evidence.source.adjustment)",
                            valueIdentifier: "annualPortfolioLabQuantSourceIdentity"
                        )
                        InfoBlock(
                            title: "计算方法",
                            value: "\(evidence.method.returnMethod) · \(evidence.method.observationAlignment) · n=\(evidence.method.observationCount) · annualization=\(evidence.method.annualizationDays) · tail=\(evidence.method.tailConfidence)",
                            valueIdentifier: "annualPortfolioLabQuantMethod"
                        )
                        InfoBlock(
                            title: "样本稳定性",
                            value: "\(evidence.stability.status) · \(evidence.stability.observationCount)/\(evidence.stability.minimumStableObservationCount) · \(evidence.stability.limitation)",
                            valueIdentifier: "annualPortfolioLabQuantStability"
                        )
                        let execution = evidence.executionEvidence
                        InfoBlock(
                            title: "模拟执行",
                            value: "signal=\(execution.signalTiming) · earliest=\(execution.earliestExecution) · same-bar=\(execution.allowsSameBarExecution) · margin=\(execution.allowsMargin) · non-zero costs=\(execution.nonZeroCosts)\nboard lots：\(execution.boardLots.map { "\($0.symbol) \($0.boardLot)" }.joined(separator: "；"))\nfees：\(execution.feeCurrency) commission \(execution.fees.commissionRate) / stamp \(execution.fees.stampDutyRate) / platform \(execution.fees.platformFee)",
                            valueIdentifier: "annualPortfolioLabQuantExecution"
                        )
                        InfoBlock(
                            title: "代码身份",
                            value: "\(evidence.codeIdentity.scriptPath) · \(evidence.codeIdentity.scriptHash)\n\(evidence.codeIdentity.configPath) · \(evidence.codeIdentity.configHash)",
                            valueIdentifier: "annualPortfolioLabQuantCodeIdentity"
                        )
                        BulletList(title: "量化证据限制", items: evidence.limitations)
                    }
                    .padding(.top, 6)
                }
                .accessibilityIdentifier("annualPortfolioLabQuantVersionAndExecution")
            }
            if !quant.correlations.candidateToPositions.isEmpty {
                BulletList(
                    title: "候选与当前持仓相关性",
                    items: quant.correlations.candidateToPositions.map { "\($0.symbol)：\($0.correlation.map { String(format: "%.4f", $0) } ?? "not_computable")" }
                )
            }
            InfoBlock(
                title: "流动性 / 整手 / 成本",
                value: "\(quant.candidateLiquidity.status) · median turnover \(annualPortfolioLabNumber(quant.candidateLiquidity.medianDailyTurnover)) · board lot \(quant.candidateLiquidity.boardLot.map(String.init) ?? "not_captured") · non-zero costs \(quant.candidateLiquidity.nonZeroCosts.map(String.init) ?? "not_captured")",
                valueIdentifier: "annualPortfolioLabLiquidity"
            )
            Text("量化层是历史研究证据，不是 Pingan 当前持仓、Futu 当前报价、预测、归因或执行输入。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func crossStockPortfolioLabComparison(_ current: AnnualPortfolioLabData) -> some View {
        let otherMemberships = candidateMemberships.memberships.filter {
            $0.actorId == selectedMembership?.actorId
                && $0.symbol != selectedMembership?.symbol
                && $0.state == .tracked
        }
        if !otherMemberships.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("对比股票", selection: Binding(
                        get: {
                            otherMemberships.contains { $0.id == comparedPortfolioLabMembershipId }
                                ? comparedPortfolioLabMembershipId ?? ""
                                : ""
                        },
                        set: { membershipId in
                            comparedPortfolioLabMembershipId = membershipId.isEmpty ? nil : membershipId
                            clearComparedAnnualPortfolioLab("股票已变化，请明确读取同金额组合风险。")
                        }
                    )) {
                        Text("请选择").tag("")
                        ForEach(otherMemberships) { membership in
                            Text("\(membership.symbol) · \(membership.research.name ?? "未命名")")
                                .tag(membership.id)
                        }
                    }
                    .accessibilityIdentifier("crossStockPortfolioLabMembershipPicker")

                    Button(isLoadingComparedPortfolioLab ? "正在读取" : "读取同金额组合风险") {
                        Task { await loadComparedAnnualPortfolioLab() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(!canLoadComparedAnnualPortfolioLab)
                    .accessibilityIdentifier("loadCrossStockPortfolioLabButton")

                    Text(comparedPortfolioLabMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("crossStockPortfolioLabMessage")

                    if let compared = comparedPortfolioLabEnvelope?.data,
                       let target = otherMemberships.first(where: {
                           $0.id == comparedPortfolioLabMembershipId
                               && $0.id == compared.target.membershipId
                               && $0.version == compared.target.membershipVersion
                               && $0.symbol == compared.target.symbol
                       }) {
                        InfoBlock(
                            title: "比较身份",
                            value: "\(current.target.symbol) #\(current.target.membershipId) v\(current.target.membershipVersion) ↔ \(compared.target.symbol) #\(compared.target.membershipId) v\(compared.target.membershipVersion)",
                            valueIdentifier: "crossStockPortfolioLabIdentity"
                        )
                        InfoBlock(
                            title: "同一组合快照",
                            value: "\(current.sourceIdentity.portfolioAsOf) · \(current.sourceIdentity.portfolioSnapshotId)",
                            valueIdentifier: "crossStockPortfolioLabSnapshot"
                        )
                        crossStockPortfolioPairSummary(current: current, compared: compared)
                        Button {
                            selectedPortfolioWorkspace = .lab
                            selectMembershipForAction(target, layer: .portfolio, expandResult: true)
                        } label: {
                            Label("切换到对比股票继续组合试算", systemImage: "arrow.right.circle")
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("openCrossStockPortfolioLab-\(target.symbol)")
                        Text("同金额横向阅读，不排名、不推荐，也不改变候选顺序、正式决定或组合事实。")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("crossStockPortfolioLabSafety")
                    }
                }
                .padding(.top, 6)
            } label: {
                Text("跨股票组合风险比较")
                    .accessibilityIdentifier("crossStockPortfolioLabComparison")
            }
        }
    }

    private func annualPortfolioLabMetric(_ value: Double?, status _: String) -> String {
        value.map { String(format: "%.2f%%", $0 * 100) } ?? "UNKNOWN"
    }

    private func annualPortfolioLabCurrency(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.currency(code: "HKD").precision(.fractionLength(2)))
    }

    private func annualPortfolioLabPercent(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.percent.precision(.fractionLength(2)))
    }

    private func annualPortfolioLabNumber(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.number.precision(.fractionLength(0 ... 4)))
    }
}
