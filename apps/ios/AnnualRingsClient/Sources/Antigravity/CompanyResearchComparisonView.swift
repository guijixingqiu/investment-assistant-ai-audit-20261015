import Foundation
import SwiftUI

private enum ComparisonChoice: Hashable {
    case none
    case cash
    case company(String)

    var key: String {
        switch self {
        case .none: "none"
        case .cash: "cash"
        case .company(let id): "company:\(id)"
        }
    }
}

private enum ComparisonRole: Equatable {
    case first
    case second
}

private enum ComparisonLane: String, CaseIterable, Hashable, Sendable {
    case workspace
    case valuation
    case context
    case documents

    var failureMessage: String {
        switch self {
        case .workspace: "经营参考、经营解释和报告读取失败"
        case .valuation: "估值情景读取失败"
        case .context: "行业、同行和 KPI 上下文读取失败"
        case .documents: "已保存资料清单读取失败"
        }
    }
}

private enum ComparisonRead: Sendable {
    case workspace(FrozenResearchEvidenceWorkspace)
    case valuation(ResearchValuationScenariosEnvelope)
    case context(ResearchContextEnvelope)
    case documents(ResearchDocumentListEnvelope)
    case failure(ComparisonLane)
}

private struct ComparisonSide {
    let membership: CandidateMembershipData
    let authorization: AppResearchAuthorizationContext
    var workspace: FrozenResearchEvidenceWorkspace?
    var valuation: ResearchValuationScenariosEnvelope?
    var context: ResearchContextEnvelope?
    var documents: ResearchDocumentListEnvelope?
    var failures: Set<ComparisonLane> = []
    var pendingReads = ComparisonLane.allCases.count

    var reference: ResearchProviderOperatingReference? { workspace?.data?.providerOperatingReference }
    var reasoning: ResearchOperatingReasoning? { workspace?.data?.operatingReasoning }
    var currentReport: TwoLayerReportData? {
        guard let report = workspace?.data?.latestReport, report.isCurrentExact else { return nil }
        return report
    }
}

/// Each company has its own validated GET results. This view never changes the shared current-company cache.
@MainActor
struct CompanyResearchComparisonView: View {
    let primary: CandidateMembershipData
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var choice: ComparisonChoice = .none
    @State private var first: ComparisonSide?
    @State private var second: ComparisonSide?
    @State private var firstRevision = UUID()
    @State private var secondRevision = UUID()
    @State private var selectedCommonPeriodId: String?

    private var eligibleSecondCompanies: [CandidateMembershipData] {
        (api.membershipEnvelope?.memberships ?? [])
            .filter { $0.state == .tracked && $0.actorId == primary.actorId && $0.id != primary.id }
            .sorted { name($0).localizedStandardCompare(name($1)) == .orderedAscending }
    }

    private func name(_ membership: CandidateMembershipData) -> String {
        membership.research.name
            ?? api.candidateOverview?.candidates.first(where: { $0.symbol == membership.symbol })?.name
            ?? membership.symbol
    }

    private func currentMember(_ id: String) -> CandidateMembershipData? {
        api.membershipEnvelope?.memberships.first {
            $0.id == id && $0.actorId == primary.actorId && $0.state == .tracked
        }
    }

    private var firstTaskKey: String {
        let current = currentMember(primary.id)
        return "\(primary.id):\(primary.version):\(current?.version ?? -1):\(current?.state.rawValue ?? "missing"):\(api.currentSymbol):\(api.authorizationRevision)"
    }

    private var secondTaskKey: String {
        let current: CandidateMembershipData?
        if case .company(let id) = choice { current = currentMember(id) } else { current = nil }
        return "\(choice.key):\(current?.version ?? -1):\(current?.state.rawValue ?? "missing"):\(api.authorizationRevision)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("两家公司 · 已存研究比较").font(.title2.bold())
                Text("先并列阅读已经保存且仍绑定当前成员的资料。此页不生成排名、交易建议或正式决定；没有正式报告也能使用。")
                    .font(.subheadline).foregroundStyle(.secondary)
                selectionCard
                if api.currentSymbol != primary.symbol {
                    Text("当前研究公司已切换。请返回研究页重新打开比较，旧结果不再显示。")
                        .foregroundStyle(.orange)
                } else if currentMember(primary.id).map({ sameIdentity($0, primary) }) != true {
                    Text("原公司的研究成员版本已变化，请返回研究页重新打开比较。")
                        .foregroundStyle(.orange)
                } else {
                    sideCard(first, membership: primary, title: "原公司")
                    switch choice {
                    case .none:
                        Text("暂不选择第二家公司：可先阅读原公司；不会保存比较或形成决定。")
                            .font(.subheadline).foregroundStyle(.secondary)
                    case .cash:
                        Text("已选择现金。现金不是第二家公司，当前没有可核对的同口径经营和估值资料；不作公司排名，也不写入正式决定。")
                            .font(.subheadline).foregroundStyle(.secondary)
                    case .company(let id):
                        if let membership = currentMember(id) {
                            sideCard(second, membership: membership, title: "对照公司")
                            if let first, let second,
                               sameIdentity(first.membership, primary),
                               sameIdentity(second.membership, membership),
                               first.authorization == AppEnvironment.researchAuthorizationContext(),
                               second.authorization == AppEnvironment.researchAuthorizationContext() {
                                if first.pendingReads == 0 && second.pendingReads == 0 {
                                    pairAssessment(first, second)
                                } else {
                                    ProgressView("正在核对两侧期间、币种与同行依据…")
                                }
                            }
                        } else {
                            Text("对照公司已不在当前可读取的研究自选中；旧结果已隐藏，请重新选择。")
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle("公司比较")
        .task(id: firstTaskKey) { await load(primary, role: .first) }
        .task(id: secondTaskKey) {
            if case .company(let id) = choice, let membership = currentMember(id) {
                await load(membership, role: .second)
            } else {
                secondRevision = UUID()
                second = nil
            }
        }
        .onChange(of: api.currentSymbol) { _, current in
            if current != primary.symbol {
                firstRevision = UUID(); secondRevision = UUID()
                first = nil; second = nil; choice = .none
            }
        }
        .onChange(of: api.authorizationRevision) { _, _ in
            firstRevision = UUID(); secondRevision = UUID()
            first = nil; second = nil
            selectedCommonPeriodId = nil
        }
    }

    private var selectionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("原公司：\(name(primary)) · \(primary.symbol)").font(.headline)
            Menu {
                Button("暂不选择") { choice = .none }
                Button("现金（不作为公司比较）") { choice = .cash }
                ForEach(eligibleSecondCompanies) { membership in
                    Button("\(name(membership)) · \(membership.symbol)") {
                        choice = .company(membership.id)
                    }
                }
            } label: {
                HStack {
                    Text(secondChoiceLabel)
                    Spacer()
                    Image(systemName: "chevron.down")
                }
                .frame(minHeight: 44)
            }
            .accessibilityIdentifier("companyComparisonSecondChoice")
            NavigationLink {
                CompanyResearchPeersView(membership: primary, onSaved: { saved in
                    if var side = first, sameIdentity(side.membership, primary) {
                        side.context = saved
                        first = side
                    } else {
                        Task { await load(primary, role: .first) }
                    }
                }, onSelect: { id in
                    if eligibleSecondCompanies.contains(where: { $0.id == id }) {
                        choice = .company(id)
                    }
                })
            } label: {
                WorkspaceRowLabel(title: "维护有来源的同行名单",
                    subtitle: "纳入或排除、原页引用、保存后回读，再选入两公司比较", icon: "person.2")
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("companyComparisonManagePeers")
            if eligibleSecondCompanies.isEmpty {
                Text("当前还没有另一家可读取的研究自选公司；可选择现金或暂不选择。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var secondChoiceLabel: String {
        switch choice {
        case .none: return "选择第二家公司 · 暂不选择"
        case .cash: return "现金 · 不作公司比较"
        case .company(let id):
            guard let membership = currentMember(id) else { return "对照公司已失效 · 请重新选择" }
            return "\(name(membership)) · \(membership.symbol)"
        }
    }

    @ViewBuilder
    private func sideCard(_ side: ComparisonSide?, membership: CandidateMembershipData, title: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(title)：\(name(membership)) · \(membership.symbol)").font(.headline)
            if let side, side.authorization == AppEnvironment.researchAuthorizationContext(),
               sameIdentity(side.membership, membership) {
                if side.pendingReads > 0 { ProgressView("正在读取 \(4 - side.pendingReads)/4 类已存资料…") }
                judgmentSection(side)
                researchChangeSection(side)
                NavigationLink {
                    CompanyComparisonExistingResearch(side: side, name: name(membership))
                } label: {
                    WorkspaceRowLabel(title: "进入这家公司的研究与原件",
                        subtitle: "按本侧成员身份核对假设、下一问题和原件", icon: "arrow.right")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("companyComparisonOpen-\(membership.symbol)")
                operatingSection(side)
                valuationSection(side)
                fcffSection(side)
                riskSection(side)
                coverageSection(side)
                if !side.failures.isEmpty {
                    ForEach(ComparisonLane.allCases.filter { side.failures.contains($0) }, id: \.self) { lane in
                        Text("\(lane.failureMessage)；本侧其他已读资料仍可查看。")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            } else {
                ProgressView("正在核对该公司研究身份…")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func judgmentSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("当前判断").font(.subheadline.bold())
            if let report = side.currentReport, let advice = report.payload.adviceLayer {
                Text(advice.conclusion)
                Text("已存报告 v\(report.version) · \(report.payload.cutoffAt) · \(report.isFormalizable ? "待人工确认" : "仅供核对")")
                    .font(.caption).foregroundStyle(.secondary)
            } else if side.workspace == nil && !side.failures.contains(.workspace) {
                Text("当前判断和经营解释正在读取。")
                    .foregroundStyle(.secondary)
            } else {
                Text("当前无可确认的正式报告判断；可继续查看已有经营参考、假设和资料。")
                    .foregroundStyle(.secondary)
            }
            if let reasoning = side.reasoning {
                Text("经营解释：\(reasoning.operatingMeaning.text)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func researchChangeSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("最近研究变化").font(.subheadline.bold())
            if let reasoning = side.reasoning, let update = reasoning.researchUpdate,
               let change = update.change,
               update.membershipId == side.membership.id,
               update.membershipVersion == side.membership.version,
               update.symbol == side.membership.symbol {
                Text("变化时间：\(WorkspaceTimestamp.hongKong(change.effectiveAt))")
                    .font(.caption).foregroundStyle(.secondary)
                Text("发生了什么：\(change.summary)")
                    .font(.caption)
                if let fact = reasoning.facts.first(where: { change.changedFactIds.contains($0.id) }) {
                    Text("当前相关事实：\(fact.text)").font(.caption)
                }
                Text("原假设评估：此前 \(change.previousAssessment.map(operatingAssessmentTitle) ?? "未记录") → 当前 \(change.currentAssessment.map(operatingAssessmentTitle) ?? "UNKNOWN")")
                    .font(.caption)
                if let impact = reasoning.thesisImpact {
                    Text("核对的原假设：\(impact.hypothesis)").font(.caption)
                    Text("假设影响：\(impact.explanation)").font(.caption)
                } else {
                    Text("原假设影响：尚未绑定可核对的原假设，UNKNOWN。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("仍未知：\(reasoning.unknown.text)")
                    .font(.caption).foregroundStyle(.secondary)
                Text("下一问题：\(update.nextQuestion)").font(.caption)
            } else if side.pendingReads > 0 {
                Text("正在读取已保存的研究变化…")
                    .font(.caption).foregroundStyle(.secondary)
            } else if side.failures.contains(.workspace)
                || side.reasoning?.researchUpdate?.change != nil {
                Text("研究变化暂不可核对；可进入本侧研究与原件重新读取。")
                    .font(.caption).foregroundStyle(.orange)
            } else {
                Text("尚无已保存的研究变化。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func operatingSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("经营参考 · 本公司各指标最新可得值").font(.subheadline.bold())
            if let reference = side.reference {
                Text("已存 OpenD 第三方原值 · \(reference.periods.count) 个期间 · 发行人原件核验 \(reference.issuerOriginalVerification)")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(["revenue", "profit_attributable_to_owners", "operating_cash_flow"], id: \.self) { metric in
                    if let value = latestValue(metric, in: side) {
                        Text("\(metricTitle(metric))：\(value.rawValue) \(value.currencyCode)（基础单位） · \(periodTitle(value))")
                            .font(.caption.monospacedDigit())
                    } else {
                        Text("\(metricTitle(metric))：UNKNOWN（已存期间缺项或原件不可用）")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let context = reference.ownerContext {
                    Text("另有 \(context.kpis.count) 项 KPI、\(context.ownerAssumptions.count) 项 Owner 假设；与提供商原值分开保存。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(context.ownerAssumptions.prefix(2).enumerated()), id: \.offset) { _, assumption in
                        Text("Owner 假设 · \(assumption.scenario) · \(assumption.metric)：\(assumption.value) \(assumption.unit) · \(assumption.periodEnd)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let question = context.questions.first {
                        Text("下一核验：\(question.question)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                Text(side.failures.contains(.workspace) ? "经营参考读取失败。"
                     : side.workspace == nil ? "经营参考正在读取。" : "当前没有可读取的已存经营参考。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func valuationSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("估值条件").font(.subheadline.bold())
            if let valuation = side.valuation {
                let issuer = valuation.scenarioSets
                    .filter { $0.scenarioState == "current" && $0.recomputable }
                    .max { $0.createdAt < $1.createdAt }
                let provider = (valuation.providerScenarioSets ?? [])
                    .filter { $0.scenarioState == "current" && $0.recomputable }
                    .max { $0.createdAt < $1.createdAt }
                if let issuer {
                    valuationLine("研究事实情景锚点", assumptions: issuer.assumptions.values,
                        period: issuer.anchor.periodEnd, currency: issuer.anchor.currency,
                        source: "材料 #\(issuer.anchor.source.materialId)",
                        result: issuer.calculation.scenarioPresentValuePerShare)
                }
                if let provider {
                    valuationLine("OpenD 提供方锚点 · 未作发行人核验",
                        assumptions: provider.assumptions.values,
                        period: provider.providerBasis.eps.periodEnd,
                        currency: provider.providerBasis.eps.currencyCode,
                        source: "材料 #\(provider.providerBasis.sourceMaterialId)",
                        result: provider.calculation.scenarioPresentValuePerShare)
                }
                if issuer == nil && provider == nil {
                    Text("没有当前可复算的已存估值情景；估值为 UNKNOWN。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text(side.failures.contains(.valuation) ? "估值情景读取失败。" : "估值情景正在读取。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func valuationLine(_ label: String, assumptions: AnnualValuationScenarioInput,
                               period: String, currency: String, source: String, result: Double) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(label) · \(source) · 指标期间 \(period) · \(currency)")
                .font(.caption)
            Text(String(format: "基准每股指标 %.2f · 增长 %.1f%% · %d 年 · 终值倍数 %.1f · 折现 %.1f%%",
                        assumptions.baseMetricPerShare, assumptions.annualGrowthRate * 100,
                        assumptions.horizonYears, assumptions.terminalMultiple,
                        assumptions.annualDiscountRate * 100))
                .font(.caption).foregroundStyle(.secondary)
            Text(String(format: "模型情景结果 %.2f %@/股；不是现价或两公司排名。", result, currency))
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func fcffSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("FCFF 折现情景 · 本侧已存").font(.subheadline.bold())
            if let valuation = side.valuation {
                let issuer = valuation.fcffScenarioSets?.filter {
                    $0.scenarioState == "current" && $0.recomputable
                }.max { $0.createdAt < $1.createdAt }
                let provider = valuation.providerFcffScenarioSets?.filter {
                    $0.scenarioState == "current" && $0.recomputable
                }.max { $0.createdAt < $1.createdAt }
                if let issuer {
                    fcffScenarioSummary("发行人原件事实 + Owner 预测", input: issuer.assumptions.values,
                        calculation: issuer.calculation, revision: issuer.revision, createdAt: issuer.createdAt)
                    Text("历史事实：年度截至 \(issuer.historicalOriginals.historicalAnnualPeriodEnd)；资产负债参考 \(issuer.historicalOriginals.balanceReferenceDate)。已核对事实 \(issuer.historicalOriginals.facts.count) 项。")
                        .font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("查看 \(issuer.historicalOriginals.facts.count) 项事实与确切原件") {
                        ForEach(issuer.historicalOriginals.facts) { fact in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(fact.metric)：\(fcffNumber(fact.value)) \(fact.currency)（原件口径 \(fact.scope)，单位倍率 \(fcffNumber(fact.unitScale))）· 期间 \(fact.periodStart ?? "时点")—\(fact.periodEnd) · 发布 \(fact.publishedAt ?? "UNKNOWN")")
                                    .font(.caption)
                                NavigationLink {
                                    CompanyComparisonFcffIssuerSourceReader(membership: side.membership,
                                        fact: fact, comparisonRootSymbol: primary.symbol)
                                } label: {
                                    Text("重开原件：材料 #\(fact.materialId) r\(fact.materialRevision) · \(fact.role)")
                                        .font(.caption)
                                }
                            }
                        }
                    }
                }
                if let provider {
                    fcffScenarioSummary("OpenD 第三方参考 + Owner 预测 · 发行人未核实", input: provider.assumptions.values,
                        calculation: provider.calculation, revision: provider.revision, createdAt: provider.createdAt)
                    Text("年度余额 \(provider.providerReference.balanceReferenceDate) · 独立股数参考 \(provider.providerReference.shareReferenceDate ?? "无") · 捕获 \(provider.providerReference.capturedAt)。发行人原文核实与披露时点 UNKNOWN。")
                        .font(.caption).foregroundStyle(.secondary)
                    if !provider.providerReference.missingRoles.isEmpty {
                        Text("第三方原页缺项：\(provider.providerReference.missingRoles.joined(separator: "、"))；由 Owner 假设补足，不视为零或发行人事实。")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    DisclosureGroup("查看 OpenD 字段、股数来源与原始页") {
                        ForEach(provider.providerReference.rows) { row in
                            Text("原页字段 \(row.fieldId) · \(row.displayName)：\(row.rawValue) \(row.currency)（基础单位）· 报告日 \(row.periodEnd) · 页 #\(row.pageId)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let share = provider.providerReference.shareReference {
                            Text("独立股数材料 #\(share.issuedMaterialId) / #\(share.treasuryMaterialId)；已发行 \(fcffNumber(share.issuedShares)) − 库存 \(fcffNumber(share.treasuryShares))，与 Owner 摊薄分母假设分开。")
                                .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("没有已核对的独立股数参考；每股分母是 Owner 假设，需核对来源。")
                                .font(.caption).foregroundStyle(.orange)
                        }
                        NavigationLink {
                            CompanyComparisonFcffProviderSourceReader(membership: side.membership,
                                reference: provider.providerReference, comparisonRootSymbol: primary.symbol)
                        } label: {
                            Text("重开 OpenD 原始页 · 材料 #\(provider.providerReference.materialId) r\(provider.providerReference.materialRevision)")
                                .font(.caption)
                        }
                    }
                }
                if issuer == nil && provider == nil {
                    let retained = (valuation.fcffScenarioSets ?? []).count
                        + (valuation.providerFcffScenarioSets ?? []).count
                    Text(retained == 0 ? "尚无已保存 FCFF 情景；FCFF 估值 UNKNOWN。"
                         : "有 \(retained) 个历史或来源已变化的 FCFF 情景；当前没有可复算值，不沿用旧结果。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text(side.failures.contains(.valuation) ? "FCFF 情景读取失败；本侧其余资料仍可阅读。"
                     : "FCFF 情景正在读取。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func fcffScenarioSummary(_ title: String, input: FcffScenarioInput,
                                     calculation: FcffScenarioCalculation, revision: Int,
                                     createdAt: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(title) · 修订 \(revision)").font(.caption.bold())
            Text("估值截止 \(input.valuationCutoff) · 历史年度 \(input.historicalAnnualPeriodEnd) · 余额参考 \(input.balanceReferenceDate) · 保存 \(createdAt)")
                .font(.caption).foregroundStyle(.secondary)
            Text("经营企业价值 \(fcffNumber(calculation.operatingEnterpriseValue)) → 普通股权益 \(fcffNumber(calculation.commonEquityValue)) \(input.currency)（基础单位）→ 每股 \(fcffNumber(calculation.commonEquityValuePerShare)) \(input.currency)/股")
                .font(.caption.monospacedDigit())
            Text("Owner 假设：WACC \(fcffPercent(input.wacc))、永续增长 \(fcffPercent(input.terminalGrowthRate))。")
                .font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("查看权益桥、年度预测与终值明细") {
                let bridge = input.bridge
                Text("权益桥：超额现金 +\(fcffNumber(bridge.excessCash))、非经营资产 +\(fcffNumber(bridge.nonOperatingAssets))、有息债 −\(fcffNumber(bridge.interestBearingDebt))、未计入债的租赁负债 −\(fcffNumber(bridge.leaseLiabilitiesNotInDebt))、少数股东权益 −\(fcffNumber(bridge.noncontrollingInterests))、其他非普通股索偿 −\(fcffNumber(bridge.otherNonordinaryClaims))；摊薄普通股 \(fcffNumber(bridge.dilutedOrdinaryShares))。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(Array(input.forecast.enumerated()), id: \.offset) { _, year in
                    Text("预测 \(year.periodStart)—\(year.periodEnd)：EBIT \(fcffNumber(year.ebit)) · 税率 \(fcffPercent(year.operatingTaxRate)) · 折旧摊销 \(fcffNumber(year.depreciationAmortization)) · 资本再投入 \(fcffNumber(year.grossCapitalReinvestment)) · 非现金营运资本增加 \(fcffNumber(year.increaseInNoncashWorkingCapital)) \(input.currency)。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("终值下一年：EBIT \(fcffNumber(input.terminalNextYear.ebit)) · 税率 \(fcffPercent(input.terminalNextYear.operatingTaxRate)) · 折旧摊销 \(fcffNumber(input.terminalNextYear.depreciationAmortization)) · 资本再投入 \(fcffNumber(input.terminalNextYear.grossCapitalReinvestment)) · 非现金营运资本增加 \(fcffNumber(input.terminalNextYear.increaseInNoncashWorkingCapital)) \(input.currency)；终值企业价值 \(fcffNumber(calculation.terminalEnterpriseValue)) \(input.currency)。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("个人模型情景，不是现价、目标价或买卖建议；预测与终值假设须由 Owner 复核。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func fcffNumber(_ value: Double) -> String { String(format: "%.2f", value) }
    private func fcffPercent(_ value: Double) -> String { String(format: "%.2f%%", value * 100) }

    private func riskSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("已记录风险与反证").font(.subheadline.bold())
            let reportRisks = side.currentReport?.payload.researchLayer?.risks.map(\.statement) ?? []
            let ownerTests = side.reference?.ownerContext?.counterEvidence.map {
                "\($0.conditionText)（\($0.status)；Owner 上下文）"
            } ?? []
            let adverseDrivers = side.context?.data?.industryDrivers
                .filter { $0.impact == "adverse" }
                .map { "\($0.statement)（行业资料，截止 \($0.cutoffAt)）" } ?? []
            let risks = Array((reportRisks + ownerTests + adverseDrivers).prefix(3))
            if risks.isEmpty {
                Text(side.pendingReads > 0 ? "风险和反证资料正在读取。"
                     : "当前没有可展示的已存风险或反证条件；不推断为低风险。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(risks.enumerated()), id: \.offset) { _, risk in
                    Text(risk).font(.caption)
                }
            }
        }
    }

    private func coverageSection(_ side: ComparisonSide) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("资料覆盖和出处").font(.subheadline.bold())
            if let documents = side.documents {
                Text("PDF \(documents.documents.filter(\.isSourceAvailable).count)/\(documents.documents.count) 份原件可读 · 已存材料 \(documents.materials.count) 条；数量不等于完整覆盖。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text(side.failures.contains(.documents) ? "资料清单读取失败，覆盖度 UNKNOWN。" : "资料清单正在读取。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let context = side.context {
                if let data = context.data, context.status == .available {
                    Text("行业：\(data.industry) · 已记录同行 \(data.peers.count) 家 · KPI \(data.operatingKpis.count) 项 · 截止 \(data.cutoffAt)")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(context.status == .notFound ? "当前没有已保存的行业/同行上下文。" : "行业/同行上下文暂不可用。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text(side.failures.contains(.context) ? "行业/同行上下文读取失败。" : "行业/同行上下文正在读取。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let reference = side.reference, !reference.gaps.isEmpty {
                ForEach(Array(reference.gaps.prefix(3)), id: \.self) { gap in
                    Text("缺口：\(gap)").font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private func pairAssessment(_ left: ComparisonSide, _ right: ComparisonSide) -> some View {
        let periods = commonPeriods(left, right)
        let selectedPeriod = periods.first { $0.id == selectedCommonPeriodId } ?? periods.first
        return VStack(alignment: .leading, spacing: 10) {
            Text("两侧口径与同行关系").font(.headline)
            if let selectedPeriod {
                Picker("共同测量期间", selection: Binding<String>(
                    get: { selectedCommonPeriodId.flatMap { id in periods.first { $0.id == id }?.id }
                        ?? selectedPeriod.id },
                    set: { selectedCommonPeriodId = $0 }
                )) {
                    ForEach(periods) { period in
                        Text(commonPeriodTitle(period)).tag(period.id)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("companyComparisonCommonPeriod")
                Text("当前对照：\(commonPeriodTitle(selectedPeriod))。只读取两侧此期间的已存 OpenD 原值；缺项保持 UNKNOWN。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(["revenue", "profit_attributable_to_owners", "operating_cash_flow"], id: \.self) { metric in
                    let a = value(metric, in: left, periodId: selectedPeriod.id)
                    let b = value(metric, in: right, periodId: selectedPeriod.id)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(metricTitle(metric)).font(.subheadline.bold())
                        Text("\(left.membership.symbol)：\(a.map { "\($0.rawValue) \($0.currencyCode) · \(periodTitle($0))" } ?? "UNKNOWN")")
                        Text("\(right.membership.symbol)：\(b.map { "\($0.rawValue) \($0.currencyCode) · \(periodTitle($0))" } ?? "UNKNOWN")")
                        Text(comparabilityNote(a, b))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .font(.caption.monospacedDigit())
                }
            } else {
                Text("两侧没有共同已存的年度或累计半年期间；经营数值对照及差额 UNKNOWN。可分别阅读上方各公司的最新经营参考。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            let peers = (left.context?.data?.peers ?? []).filter { $0.symbol == right.membership.symbol }
                + (right.context?.data?.peers ?? []).filter { $0.symbol == left.membership.symbol }
            if peers.isEmpty {
                Text("现有上下文未证明两家公司互为可比同行；商业模式可比性 UNKNOWN。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(peers.enumerated()), id: \.offset) { _, peer in
                    let issue = (peer.selectedSymbol == left.membership.symbol
                        ? left.context : right.context)?.peerSourceIssues?.first { $0.peerId == peer.id }
                    let relation = issue == nil
                        ? (peer.status == "included" ? "纳入" : "排除") : "依据待修复"
                    NavigationLink {
                        CompanyPeerCitationReader(
                            membership: peer.selectedSymbol == left.membership.symbol
                                ? left.membership : right.membership,
                            peer: peer, comparisonRootSymbol: primary.symbol)
                    } label: {
                        Text("\(peer.selectedSymbol) 对 \(peer.symbol)：\(relation) · \(peer.reason) · \(peer.citation.sourceLabel)")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                }
            }
            savedPeerFactComparison(left, peerSymbol: right.membership.symbol)
            savedPeerFactComparison(right, peerSymbol: left.membership.symbol)
            fcffPairNote(left, right)
            Text("风险文字相似不能证明共同敞口；仅对测量期间、指标、单位和币种一致的已存事实显示差额，不相减其他经营或估值结果，也不生成排名。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("companyComparisonAssessment")
    }

    private func fcffPairNote(_ left: ComparisonSide, _ right: ComparisonSide) -> some View {
        let leftInputs = currentFcffInputs(left)
        let rightInputs = currentFcffInputs(right)
        return VStack(alignment: .leading, spacing: 3) {
            Text("FCFF 口径提示").font(.subheadline.bold())
            if leftInputs.isEmpty || rightInputs.isEmpty {
                Text("至少一侧没有当前可复算的 FCFF 情景；缺失侧保持 UNKNOWN。上方仍可分别阅读已有情景和来源。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                let aligned = leftInputs.contains { a in rightInputs.contains { b in
                    a.currency == b.currency && a.valuationCutoff == b.valuationCutoff
                        && a.historicalAnnualPeriodEnd == b.historicalAnnualPeriodEnd
                        && a.balanceReferenceDate == b.balanceReferenceDate
                } }
                Text(aligned
                     ? "两侧至少一组情景的币种、估值截止、历史年度和余额参考日一致；预测、终值、权益桥及来源仍需逐项核对，不计算差额或排名。"
                     : "两侧当前 FCFF 情景的币种、估值截止或历史/余额参考期间不一致；不换汇、不相减、不作高低判断。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func currentFcffInputs(_ side: ComparisonSide) -> [FcffScenarioInput] {
        (side.valuation?.fcffScenarioSets ?? []).filter {
            $0.scenarioState == "current" && $0.recomputable
        }.map { $0.assumptions.values }
        + (side.valuation?.providerFcffScenarioSets ?? []).filter {
            $0.scenarioState == "current" && $0.recomputable
        }.map { $0.assumptions.values }
    }

    @ViewBuilder
    private func savedPeerFactComparison(_ side: ComparisonSide, peerSymbol: String) -> some View {
        if let peer = side.context?.data?.peers.first(where: { $0.symbol == peerSymbol }),
           side.context?.peerSourceIssues?.contains(where: { $0.peerId == peer.id }) == true {
            Text("\(peerSymbol) 的可比理由来源待修复；已存数值暂不作为有效比较。")
                .font(.caption).foregroundStyle(.orange)
        }
        if let data = side.context?.data,
           data.peers.contains(where: { peer in peer.symbol == peerSymbol && peer.status == "included"
               && side.context?.peerSourceIssues?.contains(where: { $0.peerId == peer.id }) != true }) {
            let comparisons = data.comparisons.filter { $0.peerSymbol == peerSymbol }
            if !comparisons.isEmpty {
                Text("\(side.membership.symbol) 已存的同行事实（逐条核对来源归属与核实状态）")
                    .font(.subheadline.bold())
                ForEach(comparisons) { item in
                    let factIssue = side.context?.peerFactSourceIssues?.first { $0.factId == item.peerFactId }
                    if let factIssue {
                        Text("\(item.metric)：来源待修复，当前不用于比较。\(factIssue.explanation)")
                            .font(.caption).foregroundStyle(.orange)
                    } else if item.status == "available", let selected = item.selectedValue,
                       let compared = item.peerValue, let selectedId = item.selectedFactId,
                       let selectedFact = data.selectedFacts.first(where: { $0.id == selectedId }),
                       let peerFact = data.peerFacts.first(where: { $0.id == item.peerFactId }),
                       let periodEnd = selectedFact.periodEnd,
                       periodEnd == peerFact.periodEnd,
                       selectedFact.periodStart == peerFact.periodStart,
                       selectedFact.unit == peerFact.unit,
                       selectedFact.currency == peerFact.currency {
                        let periodLabel = "\(peerFact.periodStart ?? "时点") 至 \(periodEnd)"
                        let values = "\(item.metric)：本公司 \(selected)，同行 \(compared)；差额（同行－本公司）\(item.delta ?? "UNKNOWN")"
                        NavigationLink {
                            CompanyPeerCitationReader(membership: side.membership, fact: peerFact,
                                comparisonRootSymbol: primary.symbol)
                        } label: {
                            Text("\(values) · \(item.unit) \(item.currency ?? "未标币种") · 测量期间 \(periodLabel) · 两侧资料截止 \(selectedFact.cutoffAt) / \(peerFact.cutoffAt) · 重开同行原件")
                                .font(.caption)
                        }
                    } else {
                        Text("\(item.metric)：不能同口径比较（\(item.reason ?? "测量期间、来源或单位不足")）")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func latestValue(_ metric: String, in side: ComparisonSide) -> FutuFinancialHistoryValue? {
        side.reference?.periods
            .sorted { $0.periodEnd > $1.periodEnd }
            .lazy.compactMap { $0.values.first(where: { $0.metric == metric }) }
            .first
    }

    private func commonPeriods(_ left: ComparisonSide, _ right: ComparisonSide) -> [ProviderOperatingPeriod] {
        let rightIds = Set(right.reference?.periods.filter { !$0.values.isEmpty }.map(\.id) ?? [])
        return (left.reference?.periods ?? [])
            .filter { !$0.values.isEmpty && rightIds.contains($0.id) }
            .sorted { a, b in
                a.periodEnd == b.periodEnd ? a.financialType < b.financialType : a.periodEnd > b.periodEnd
            }
    }

    private func commonPeriodTitle(_ period: ProviderOperatingPeriod) -> String {
        "\(period.financialType == "ANNUAL" ? "年度" : "累计半年") · 截至 \(period.periodEnd)"
    }

    private func value(_ metric: String, in side: ComparisonSide, periodId: String) -> FutuFinancialHistoryValue? {
        side.reference?.periods.first { $0.id == periodId }?.values.first { $0.metric == metric }
    }

    private func periodTitle(_ value: FutuFinancialHistoryValue) -> String {
        "\(value.financialType == "ANNUAL" ? "年度" : "累计半年") \(value.periodStart ?? "期末")—\(value.periodEnd) · \(value.periodKind)"
    }

    private func metricTitle(_ metric: String) -> String {
        switch metric {
        case "revenue": "营业总收入"
        case "profit_attributable_to_owners": "归母净利润"
        case "operating_cash_flow": "经营现金流净额"
        default: metric
        }
    }

    private func comparabilityNote(_ left: FutuFinancialHistoryValue?, _ right: FutuFinancialHistoryValue?) -> String {
        guard let left, let right else { return "一侧缺项，不能比较数值。" }
        guard left.financialType == right.financialType, left.periodKind == right.periodKind else {
            return "年度/半年或时点/期间口径不同，不相减。"
        }
        guard left.periodStart == right.periodStart, left.periodEnd == right.periodEnd else {
            return "统计期间不同，不相减。"
        }
        guard left.currencyCode == right.currencyCode else {
            return "币种不同且没有已确认换算，不相减。"
        }
        guard let leftAmount = Decimal(string: left.rawValue, locale: Locale(identifier: "en_US_POSIX")),
              let rightAmount = Decimal(string: right.rawValue, locale: Locale(identifier: "en_US_POSIX")) else {
            return "原值无法按基础单位读取，差额 UNKNOWN。"
        }
        let difference = NSDecimalNumber(decimal: rightAmount - leftAmount).stringValue
        return "差额（对照公司－原公司）\(difference) \(left.currencyCode)（基础单位）；来源仍为第三方，商业模式及重述可比性 UNKNOWN。"
    }

    private func sameIdentity(_ left: CandidateMembershipData, _ right: CandidateMembershipData) -> Bool {
        left.id == right.id && left.version == right.version && left.actorId == right.actorId
            && left.symbol == right.symbol && left.state == .tracked && right.state == .tracked
    }

    private func stillCurrent(_ membership: CandidateMembershipData, role: ComparisonRole,
                              revision: UUID, authorization: AppResearchAuthorizationContext) -> Bool {
        guard !Task.isCancelled, authorization == AppEnvironment.researchAuthorizationContext(),
              api.currentSymbol == primary.symbol,
              let current = currentMember(membership.id), sameIdentity(current, membership) else { return false }
        switch role {
        case .first: return revision == firstRevision && sameIdentity(membership, primary)
        case .second:
            guard case .company(let id) = choice else { return false }
            return revision == secondRevision && id == membership.id
        }
    }

    private func load(_ membership: CandidateMembershipData, role: ComparisonRole) async {
        let revision = UUID()
        selectedCommonPeriodId = nil
        if role == .first { firstRevision = revision; first = nil }
        else { secondRevision = revision; second = nil }
        let authorization = AppEnvironment.researchAuthorizationContext()
        guard stillCurrent(membership, role: role, revision: revision, authorization: authorization) else { return }
        var initial = ComparisonSide(membership: membership, authorization: authorization)
        if role == .first { first = initial } else { second = initial }
        let client = ResearchClient(baseURL: authorization.baseURL, authToken: authorization.readToken,
                                    authHeaderName: authorization.readHeaderName)
        await withTaskGroup(of: ComparisonRead.self) { group in
            group.addTask {
                do { return .workspace(try await client.fetchFrozenResearchEvidence(membership: membership)) }
                catch { return .failure(.workspace) }
            }
            group.addTask {
                do { return .valuation(try await client.fetchResearchValuationScenarios(membership: membership)) }
                catch { return .failure(.valuation) }
            }
            group.addTask {
                do { return .context(try await client.fetchResearchContext(membership: membership)) }
                catch { return .failure(.context) }
            }
            group.addTask {
                do { return .documents(try await client.fetchResearchDocuments(membership: membership)) }
                catch { return .failure(.documents) }
            }
            for await update in group {
                guard stillCurrent(membership, role: role, revision: revision, authorization: authorization) else {
                    group.cancelAll()
                    return
                }
                initial = role == .first ? (first ?? initial) : (second ?? initial)
                initial.pendingReads = max(0, initial.pendingReads - 1)
                switch update {
                case .workspace(let value): initial.workspace = value
                case .valuation(let value): initial.valuation = value
                case .context(let value): initial.context = value
                case .documents(let value): initial.documents = value
                case .failure(let lane): initial.failures.insert(lane)
                }
                if role == .first { first = initial } else { second = initial }
            }
        }
    }
}

/// Existing research and source readers are bound to the selected side, not to the global current symbol.
private struct CompanyComparisonExistingResearch: View {
    let side: ComparisonSide
    let name: String
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var limitedSelection: PersonalInvestigationSelection?

    private var isCurrent: Bool {
        side.authorization == AppEnvironment.researchAuthorizationContext()
            && api.membershipEnvelope?.memberships.contains(where: {
                $0.id == side.membership.id && $0.version == side.membership.version
                    && $0.actorId == side.membership.actorId && $0.symbol == side.membership.symbol
                    && $0.state == .tracked
            }) == true
    }

    var body: some View {
        ClientPage(title: "\(name) · 研究与来源") {
            if !isCurrent {
                Text("授权或研究成员版本已变化，旧公司资料不再显示。请返回比较页重新读取。")
                    .font(.subheadline).foregroundStyle(.orange)
            } else {
            Text("\(side.membership.symbol) · 本侧成员版本 \(side.membership.version)")
                .font(.caption).foregroundStyle(.secondary)
            PersonalResearchBriefSection(membership: side.membership, presentation: .analysis)
            if let reference = side.reference {
                NavigationLink {
                    ProviderOperatingReferenceView(reference: reference) {
                        limitedSelection = PersonalInvestigationSelection(
                            membershipId: side.membership.id, membershipVersion: side.membership.version,
                            symbol: side.membership.symbol, mode: "earnings_quality", question: "",
                            startAnalysis: false, resumeExisting: false)
                    }
                } label: {
                    WorkspaceRowLabel(title: "已存经营原值与来源", subtitle: "第三方未核实；查看期间、原页和缺项", icon: "chart.bar.doc.horizontal")
                }.buttonStyle(.plain)
            }
            Text("已保存 PDF 原件").font(.headline)
            if let documents = side.documents {
                if documents.documents.isEmpty {
                    Text("当前公司没有已保存的 PDF 原件。").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(documents.documents) { document in
                    if document.isSourceAvailable {
                        NavigationLink {
                            CompanyDocumentReader(membership: side.membership, document: document)
                        } label: {
                            WorkspaceRowLabel(title: document.title,
                                subtitle: "\(document.publishedAt.prefix(10)) · \(document.pageCount) 页 · 原件可读",
                                icon: "doc.text")
                        }.buttonStyle(.plain)
                    } else {
                        Text("\(document.title) · 原件不可用")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            } else {
                Text("本侧 PDF 清单尚未取得；可返回比较页重试读取。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            }
        }
        .sheet(item: $limitedSelection) { PersonalInvestigationView(selection: $0) }
    }
}

@MainActor
private struct CompanyComparisonFcffIssuerSourceReader: View {
    let membership: CandidateMembershipData
    let fact: FcffSourceFact
    let comparisonRootSymbol: String
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var document: ResearchDocumentData?
    @State private var page: ResearchDocumentPageData?
    @State private var sourceText: String?
    @State private var sourceURL: URL?
    @State private var issue = ""
    @State private var readAuthorization: AppResearchAuthorizationContext?

    private var isCurrent: Bool {
        api.currentSymbol == comparisonRootSymbol
            && readAuthorization == AppEnvironment.researchAuthorizationContext()
            && api.membershipEnvelope?.memberships.contains(where: {
                $0.id == membership.id && $0.version == membership.version
                    && $0.actorId == membership.actorId && $0.symbol == membership.symbol
                    && $0.state == .tracked
            }) == true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("\(membership.symbol) · \(fact.metric)").font(.headline)
                Text("材料 #\(fact.materialId) r\(fact.materialRevision) · \(fact.periodStart ?? "时点")—\(fact.periodEnd) · \(fact.currency) · 发布 \(fact.publishedAt ?? "UNKNOWN")")
                    .font(.caption).foregroundStyle(.secondary)
                if !isCurrent {
                    Text("研究身份或读取授权已变化；旧原件已隐藏，请返回比较页重新打开。")
                        .font(.caption).foregroundStyle(.orange)
                } else if let sourceText {
                    Text(sourceText).font(.caption).textSelection(.enabled)
                    if let document, let page {
                        NavigationLink {
                            CompanyDocumentReader(membership: membership, document: document,
                                pageNumber: page.pageNumber)
                        } label: {
                            Text("打开 PDF 第 \(page.pageNumber) 页 · \(document.title)")
                                .font(.caption)
                        }
                    }
                    if let sourceURL { Link("打开公开来源地址（现网页可能已变化）", destination: sourceURL) }
                } else if !issue.isEmpty {
                    Text(issue).font(.caption).foregroundStyle(.orange)
                    Button("重新核对原件") { Task { await load() } }
                } else {
                    ProgressView("正在核对确切原件…")
                }
            }.padding()
        }
        .navigationTitle("FCFF 原件")
        .task(id: "\(membership.id):\(membership.version):\(fact.id):\(fact.originalSha256):\(api.currentSymbol):\(api.authorizationRevision)") {
            await load()
        }
    }

    private func load() async {
        document = nil; page = nil; sourceText = nil; sourceURL = nil; issue = ""
        let auth = AppEnvironment.researchAuthorizationContext()
        readAuthorization = auth
        guard isCurrent else { issue = "研究身份已变化，不能沿用旧原件。"; return }
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
                                    authHeaderName: auth.readHeaderName)
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            guard let material = list.materials.first(where: {
                $0.id == fact.materialId && $0.revision == fact.materialRevision
                    && $0.revisionState == "current" && $0.freshness == "fresh"
                    && $0.validates(expected: membership)
            }) else { throw ResearchDocumentClientError.invalidResponse }
            if let citation = material.citation {
                guard citation.pageTextSha256 == fact.citationSha256,
                      let match = list.documents.first(where: {
                          $0.id == citation.documentId && $0.pdfSha256 == fact.originalSha256
                              && $0.isSourceAvailable && $0.membershipId == membership.id
                              && $0.membershipVersionAtImport == membership.version
                      }) else { throw ResearchDocumentClientError.invalidResponse }
                let exact = try await client.fetchResearchDocumentPage(membership: membership,
                    documentId: match.id, pageNumber: citation.pageNumber)
                guard exact.pageTextSha256 == fact.citationSha256,
                      !Task.isCancelled, isCurrent else { throw ResearchDocumentClientError.invalidResponse }
                document = match; page = exact; sourceText = exact.normalizedText
            } else if let citation = material.snapshotCitation,
                      let original = material.snapshotOriginal {
                let snapshot = try await client.readResearchSourceSnapshot(membership: membership,
                    snapshotId: citation.snapshotId)
                _ = try await client.readResearchSourceSnapshotOriginal(membership: membership,
                    snapshot: snapshot)
                guard snapshot.rawSha256 == fact.originalSha256,
                      original.rawSha256 == fact.originalSha256,
                      snapshot.textSha256 == fact.citationSha256,
                      citation.textSha256 == fact.citationSha256,
                      material.sourceUrl == snapshot.responseUrl,
                      let text = snapshot.normalizedText,
                      !Task.isCancelled, isCurrent else { throw ResearchDocumentClientError.invalidResponse }
                sourceURL = URL(string: snapshot.responseUrl)
                sourceText = text
            } else { throw ResearchDocumentClientError.invalidResponse }
        } catch {
            guard !Task.isCancelled, isCurrent else { return }
            issue = "确切材料修订、引用页或原件不可用；未展示替代来源。"
        }
    }
}

/// Reopens the saved provider capture for this side. The exact material revision and page hashes
/// must still match; a changed source does not turn into a plausible looking cached page.
@MainActor
private struct CompanyComparisonFcffProviderSourceReader: View {
    private struct SourcePage: Identifiable {
        let id: String
        let text: String
    }
    let membership: CandidateMembershipData
    let reference: FcffProviderReference
    let comparisonRootSymbol: String
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var originalPages: [SourcePage] = []
    @State private var issue = ""
    @State private var loading = true
    @State private var readAuthorization: AppResearchAuthorizationContext?

    private var isCurrent: Bool {
        api.currentSymbol == comparisonRootSymbol
            && readAuthorization == AppEnvironment.researchAuthorizationContext()
            && api.membershipEnvelope?.memberships.contains(where: {
                $0.id == membership.id && $0.version == membership.version
                    && $0.actorId == membership.actorId && $0.symbol == membership.symbol
                    && $0.state == .tracked
            }) == true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("\(membership.symbol) · OpenD 原始页").font(.headline)
                Text("第三方报表原值 · 捕获 #\(reference.financialCaptureId) · 材料 #\(reference.materialId) r\(reference.materialRevision) · 余额 \(reference.balanceReferenceDate)")
                    .font(.caption).foregroundStyle(.secondary)
                if !isCurrent {
                    Text("研究身份或读取授权已变化；旧原页已隐藏，请返回比较页重新打开。")
                        .font(.caption).foregroundStyle(.orange)
                } else if loading {
                    ProgressView("正在核对材料与原始页…")
                } else if !issue.isEmpty {
                    Text(issue).font(.caption).foregroundStyle(.orange)
                    Button("重新核对原页") { Task { await load() } }
                } else {
                    ForEach(originalPages, id: \.id) { page in
                        DisclosureGroup("原始页 #\(page.id)") {
                            Text(page.text).font(.caption.monospaced()).textSelection(.enabled)
                        }
                    }
                    Text("发行人原件核实与准确披露时点 UNKNOWN；原页金额、股数与 Owner 预测分开判断。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.padding()
        }
        .navigationTitle("FCFF 来源")
        .task(id: "\(membership.id):\(membership.version):\(reference.sourceFingerprint):\(api.currentSymbol):\(api.authorizationRevision)") {
            await load()
        }
    }

    private func load() async {
        originalPages = []; issue = ""; loading = true
        let auth = AppEnvironment.researchAuthorizationContext()
        readAuthorization = auth
        guard isCurrent, reference.membershipId == membership.id,
              reference.membershipVersion == membership.version,
              reference.symbol == membership.symbol else {
            loading = false; issue = "研究成员版本已变化，无法沿用旧来源。"; return
        }
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
                                    authHeaderName: auth.readHeaderName)
        do {
            let list = try await client.fetchResearchDocuments(membership: membership)
            guard list.materials.contains(where: {
                $0.id == reference.materialId && $0.revision == reference.materialRevision
                    && $0.contentFingerprint == reference.materialFingerprint
                    && $0.revisionState == "current" && $0.freshness == "fresh"
                    && $0.sourceType == "futu_opend_financial_statement_provider"
                    && $0.futuFinancialSource?.captureId == reference.financialCaptureId
                    && $0.validates(expected: membership)
            }) else { throw ResearchDocumentClientError.invalidResponse }
            let capture = try await client.readFutuFinancialCapture(membership: membership,
                captureId: reference.financialCaptureId)
            var pages: [SourcePage] = []
            for pageId in Array(Set(reference.rows.map(\.pageId))).sorted() {
                let rows = reference.rows.filter { $0.pageId == pageId }
                guard let page = capture.pages.first(where: { page in
                    page.id == pageId && rows.allSatisfy { row in
                        row.rawSha256 == page.rawSha256
                            && page.reports.contains(where: { $0.reportSha256 == row.reportSha256 })
                    }
                }) else { throw ResearchDocumentClientError.invalidResponse }
                let original = try await client.readFutuFinancialOriginal(membership: membership,
                    capture: capture, page: page)
                pages.append(SourcePage(id: pageId, text: original.rawText))
            }
            guard !Task.isCancelled, isCurrent else { return }
            originalPages = pages
            loading = false
        } catch {
            guard !Task.isCancelled, isCurrent else { return }
            issue = "确切材料修订或原始页不可用；未展示未经核对的替代来源。"
            loading = false
        }
    }
}
