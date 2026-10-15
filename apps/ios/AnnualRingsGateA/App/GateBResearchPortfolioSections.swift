import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func portfolioDecisionLayerContent() -> some View {
        dailyWorkspacePicker(
            DailyPortfolioWorkspace.allCases.map {
                DailyWorkspaceOption(id: $0.rawValue, title: $0.title, detail: $0.detail, systemImage: $0.systemImage)
            },
            selectedID: selectedPortfolioWorkspace.rawValue,
            tint: DailyDecisionRingLayer.portfolio.tint,
            accessibilityPrefix: "dailyPortfolioWorkspace"
        ) { rawValue in
            guard let workspace = DailyPortfolioWorkspace(rawValue: rawValue) else { return }
            selectedPortfolioWorkspace = workspace
        }

        switch selectedPortfolioWorkspace {
        case .current:
            currentPortfolioWorkspace()
        case .risk:
            portfolioRiskInputSection()

            if let impact = portfolioRiskImpact {
                portfolioRiskResultSection(impact)
            }
        case .lab:
            annualPortfolioLabSection()
        }
    }

    @ViewBuilder
    private func currentPortfolioWorkspace() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("当前组合")
                    .accessibilityIdentifier("portfolioDecisionTitle")
                Spacer()
                Label(
                    portfolioContext?.status.rawValue ?? (isLoadingPortfolioContext ? "loading" : "unavailable"),
                    systemImage: portfolioContext?.status == .available ? "checkmark.circle.fill" : "exclamationmark.circle"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(portfolioContext?.status == .available ? .green : .orange)
                .accessibilityIdentifier("portfolioDecisionStatus")
            }

            Text(portfolioContextMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("portfolioDecisionMessage")

            if let context = portfolioContext {
                portfolioIdentitySection(context)
                portfolioSummarySection(context)
                portfolioPositionList(context.positions)
                currentHoldingLogicEventsSection()
                portfolioBoundarySection(context)
            } else {
                Text("没有可展示的当前组合事实。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("portfolioDecisionNoFacts")
            }

            Button {
                Task { await loadPortfolioDecisionContext() }
            } label: {
                Label(isLoadingPortfolioContext ? "读取中" : "刷新当前组合", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingPortfolioContext || isLoadingPortfolioRisk)
            .accessibilityIdentifier("refreshPortfolioDecisionButton")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("portfolioDecisionContextSection")
    }

    @ViewBuilder
    private func currentHoldingLogicEventsSection() -> some View {
        let data = frozenResearchEvidenceWorkspace.envelope?.data
        let events = (data?.events ?? [])
            .filter { currentHoldingEventMatches($0, symbol: parsedSymbol?.canonical ?? "") }
            .sorted { $0.eventVersion > $1.eventVersion }
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle("持仓逻辑变化")
                ForEach(events) { event in
                    let material = data?.materials.first { $0.id == event.source.materialId }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(material?.title ?? "已核对持仓事件 #\(event.id)")
                            .font(.callout.weight(.semibold))
                        Text(material?.summary ?? "材料摘要不可用；未用当前事实回填。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        InfoBlock(title: "关键变量", value: event.keyVariable)
                        InfoBlock(title: "假设影响", value: portfolioResearchEventImpactLabel(event.hypothesisImpact))
                        if let binding = event.holdingBinding {
                            DisclosureGroup("持仓快照身份") {
                                VStack(alignment: .leading, spacing: 5) {
                                    InfoBlock(title: "账户范围", value: binding.accountScopeId)
                                    InfoBlock(title: "快照", value: binding.snapshotId)
                                    InfoBlock(title: "截止", value: binding.sourceAsOf)
                                    InfoBlock(title: "持仓行", value: binding.positionSourceRowId)
                                }
                                .padding(.top, 5)
                            }
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier("holdingLogicEvent-\(event.id)")
                }
                Text("这里只解释当前持仓对应的研究逻辑变化；不会修改持仓、现金、费用或创建交易。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            .id("holdingLogicChanges")
            .accessibilityIdentifier("holdingLogicChanges")
        }
    }

    private func portfolioIdentitySection(_ context: PortfolioDecisionContextEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            InfoBlock(title: "持仓来源", value: "平安导入快照", valueIdentifier: "portfolioAuthoritySource")
            InfoBlock(title: "组合时间", value: context.portfolioAsOf ?? "未提供", valueIdentifier: "portfolioAsOf")
            InfoBlock(title: "组装时间", value: context.assembledAt, valueIdentifier: "portfolioAssembledAt")
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 7) {
                    InfoBlock(title: "账户范围", value: context.accountScopeId ?? "未提供", valueIdentifier: "portfolioAccountScopeId")
                    InfoBlock(title: "快照标识", value: context.portfolioSnapshotId ?? "未提供", valueIdentifier: "portfolioSnapshotId")
                    InfoBlock(title: "事实集标识", value: context.contextId ?? "未提供", valueIdentifier: "portfolioContextId")
                }
                .padding(.top, 6)
            } label: {
                Label("来源身份", systemImage: "checkmark.shield")
                    .font(.callout.weight(.semibold))
            }
        }
    }

    private func portfolioSummarySection(_ context: PortfolioDecisionContextEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionTitle("组合概览")
            InfoBlock(
                title: "持仓市值",
                value: portfolioCurrency(context.summary.marketValue.amount),
                valueIdentifier: "portfolioMarketValue"
            )
            InfoBlock(
                title: "现金",
                value: "未知（平安权威快照未提供）",
                valueIdentifier: "portfolioCashStatus"
            )
            InfoBlock(
                title: "集中度",
                value: portfolioConcentrationText(context.summary.concentration),
                valueIdentifier: "portfolioConcentration"
            )
            if !context.gaps.isEmpty {
                BulletList(title: "事实缺口", items: context.gaps)
                    .accessibilityIdentifier("portfolioContextGaps")
            }
        }
    }

    private func portfolioPositionList(_ positions: [PortfolioDecisionPosition]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("持仓与报价")
            ForEach(positions, id: \.sourceRowId) { position in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(position.symbol)
                            .font(.callout.weight(.semibold))
                        if let name = position.name, !name.isEmpty {
                            Text(name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(position.quote.status.userLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(position.quote.status == .current ? .green : .orange)
                    }
                    InfoBlock(title: "数量", value: portfolioNumber(position.quantity))
                    InfoBlock(title: "最新价", value: portfolioCurrency(position.latestPrice))
                    InfoBlock(title: "市值", value: portfolioCurrency(position.marketValue))
                    InfoBlock(title: "组合占比", value: portfolioPercent(position.marketWeight))
                    InfoBlock(title: "报价来源", value: assetsQuoteSourceLabel(position.quote.source))
                    InfoBlock(
                        title: "Futu 报价时间",
                        value: position.quote.quoteAsOf ?? "未提供",
                        valueIdentifier: "portfolioQuoteAsOf-\(position.symbol)"
                    )
                    InfoBlock(
                        title: "Futu 抓取时间",
                        value: position.quote.fetchedAt ?? "未提供",
                        valueIdentifier: "portfolioQuoteFetchedAt-\(position.symbol)"
                    )
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("portfolioPosition-\(position.symbol)")
            }
        }
    }

    private func portfolioBoundarySection(_ context: PortfolioDecisionContextEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            InfoBlock(
                title: "事实边界",
                value: "持仓=平安；报价=Futu；现金=未知",
                valueIdentifier: "portfolioFactAuthorityBoundary"
            )
            InfoBlock(
                title: "使用边界",
                value: "本地开发与 Local Beta 辅助决策；生产组合、券商对账、会计和执行均为 blocked。",
                valueIdentifier: "portfolioDataUseBoundary"
            )
            InfoBlock(
                title: "风险可用性",
                value: context.dataUse.advisoryRiskImpact,
                valueIdentifier: "portfolioRiskAvailability"
            )
        }
    }

    private func portfolioRiskInputSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("中性风险情景")
                .accessibilityIdentifier("portfolioRiskTitle")

            TextField("情景金额（HKD）", text: $portfolioAmountInput)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .focused($isPortfolioAmountFocused)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button {
                            isPortfolioAmountFocused = false
                        } label: {
                            Label("收起风险金额键盘", systemImage: "keyboard.chevron.compact.down")
                        }
                        .accessibilityIdentifier("portfolioRiskKeyboardDone")
                    }
                }
                .accessibilityIdentifier("portfolioRiskAmountInput")

            Button {
                isPortfolioAmountFocused = false
                Task { await calculatePortfolioRiskImpact() }
            } label: {
                Label(isLoadingPortfolioRisk ? "计算中" : "计算风险影响", systemImage: "shield.lefthalf.filled")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canCalculatePortfolioRisk)
            .accessibilityIdentifier("calculatePortfolioRiskButton")

            if let portfolioRiskMessage {
                Text(portfolioRiskMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("portfolioRiskMessage")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("portfolioRiskInputSection")
    }

    private func portfolioRiskResultSection(_ impact: PortfolioRiskImpactEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("风险影响结果")
            InfoBlock(title: "候选", value: impact.candidateSymbol, valueIdentifier: "portfolioRiskCandidate")
            InfoBlock(title: "用户金额", value: portfolioCurrency(impact.hypotheticalAmount), valueIdentifier: "portfolioRiskAmount")
            InfoBlock(title: "当前候选市值", value: portfolioCurrency(impact.current.marketValue))
            InfoBlock(title: "当前候选占比", value: portfolioPercent(impact.current.weight))
            InfoBlock(title: "情景后组合市值", value: portfolioCurrency(impact.scenario.totalMarketValue))
            InfoBlock(title: "情景后候选占比", value: portfolioPercent(impact.scenario.candidateWeight), valueIdentifier: "portfolioRiskCandidateWeight")
            InfoBlock(title: "占比变化", value: portfolioPercent(impact.scenario.weightChange), valueIdentifier: "portfolioRiskWeightChange")
            InfoBlock(title: "情景后最大仓位", value: portfolioPercent(impact.scenario.largestPositionWeight))
            InfoBlock(title: "情景后 HHI", value: portfolioNumber(impact.scenario.hhi))
            InfoBlock(
                title: "辅助边界",
                value: "不生成方向、金额、目标权重、时点或收益承诺；不创建订单，不执行生产写入。",
                valueIdentifier: "portfolioRiskGuardrails"
            )
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("portfolioRiskResult")
    }

    private func portfolioConcentrationText(_ value: PortfolioDecisionConcentrationSummary) -> String {
        guard value.status == .available else { return "unavailable" }
        return "最大仓位 \(portfolioPercent(value.largestPositionWeight))；前三 \(portfolioPercent(value.topThreeWeight))；HHI \(portfolioNumber(value.hhi))"
    }

    private func portfolioCurrency(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.currency(code: "HKD").precision(.fractionLength(2)))
    }

    private func portfolioPercent(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.percent.precision(.fractionLength(2)))
    }

    private func portfolioNumber(_ value: Double?) -> String {
        guard let value else { return "unavailable" }
        return value.formatted(.number.precision(.fractionLength(0 ... 4)))
    }

    private func portfolioResearchEventImpactLabel(_ value: String) -> String {
        switch value {
        case "supports": "支持当前假设"
        case "weakens": "削弱当前假设"
        default: "仍待核实"
        }
    }
}
