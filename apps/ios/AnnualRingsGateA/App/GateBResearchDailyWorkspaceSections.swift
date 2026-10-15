import SwiftUI
extension GateBResearchScreen {
    var currentDeepResearchReport: TwoLayerReportData? {
        selectedMembershipResearchReports.first(where: \.isCurrentExact)
    }
    var latestResearchReportForStatus: TwoLayerReportData? {
        selectedMembershipResearchReports.max { $0.version < $1.version }
    }
    var currentDeepResearchDecision: TwoLayerReportDecision? {
        guard let report = currentDeepResearchReport else { return nil }
        return twoLayerReportWorkspace.envelope?.data?.decisions.first { $0.reportId == report.id }
    }
    var dailyDecisionRingStatuses: [DailyDecisionRingLayer: String] {
        [
            .candidate: dailyRingStatusLabel(candidateOverview.status.rawValue),
            .evidence: selectedMembership == nil
                ? (envelope.data == nil ? "不可用" : "已读取")
                : currentDeepResearchReport.map { report in
                    if currentDeepResearchDecision?.decision == "confirmed" { return "报告已确认" }
                    if currentDeepResearchDecision?.decision == "rejected" { return "报告需修订" }
                    return report.isFormalizable ? "报告待确认" : "报告待补充"
                } ?? annualDecisionBriefStateLabel(annualDecisionBriefModel.state),
            .portfolio: isLoadingPortfolioLab
                ? "情景读取中"
                : portfolioLabEnvelope.data.map { "\($0.scenarios.count) 个情景" }
                    ?? portfolioContext.map { dailyRingStatusLabel($0.status.rawValue) }
                    ?? (isLoadingPortfolioContext ? "读取中" : "不可用"),
            .decision: hasCurrentDecision ? "已记录" : "待人工判断",
            .review: currentSubmittedReview == nil ? "待复盘" : "已复盘"
        ]
    }
    @ViewBuilder
    func dailyDecisionNextStepCard(layout: DailyWorkbenchLayoutMetrics) -> some View {
        let step = dailyDecisionNextStep
        VStack(alignment: .leading, spacing: 8) {
            Text("唯一下一步")
                .font(.caption)
                .foregroundStyle(OwnerExperienceStyle.accent)
                .accessibilityIdentifier("dailyDecisionPath")
            dailyNextStepCopy(step)
            dailyNextStepButton(step)
        }
        .cardStyle(padding: layout.cardPadding)
        .overlay {
            RoundedRectangle(cornerRadius: OwnerExperienceStyle.cardCornerRadius, style: .continuous)
                .stroke(OwnerExperienceStyle.accent, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dailyDecisionNextStepCard")
    }
    @ViewBuilder
    func researchInvestmentBrief(layout: DailyWorkbenchLayoutMetrics) -> some View {
        let step = dailyDecisionNextStep
        VStack(alignment: .leading, spacing: 12) {
            if twoLayerReportWorkspace.retryAction == .load {
                Text("研究报告读取失败，暂不能判断本次变化；已保存的历史结果不代表当前判断。")
                    .font(.caption).foregroundStyle(OwnerExperienceStyle.warning)
                    .accessibilityIdentifier("researchBriefReadFailure")
                Button("重新读取研究报告") { Task { await loadTwoLayerReports() } }
                    .disabled(twoLayerReportWorkspace.isBusy)
            }
            if let report = researchInvestmentBriefCurrentReport,
               let advice = report.payload.adviceLayer,
               let research = report.payload.researchLayer {
                researchInvestmentBriefContent(
                    report: report,
                    advice: advice,
                    research: research,
                    step: step
                )
                DisclosureGroup("核对已存经营与估值依据") {
                    companyBusinessReadout()
                }
            } else {
                companyBusinessReadout()
                if let technical = currentMarketWeinsteinEnvelope {
                    DisclosureGroup("当前周线观察（不代替公司判断）") {
                        researchTechnicalBriefContent(technical)
                    }
                }
                if let report = researchInvestmentBriefReport,
                   let advice = report.payload.adviceLayer {
                    DisclosureGroup("历史报告 · 需重新核对") {
                        Text(advice.conclusion)
                            .font(.callout)
                        researchOwnerStatusCard(report: report)
                    }
                }
            }
            researchOnboardingEntry()
            limitedResearchEntry()
        }
        .cardStyle(padding: layout.cardPadding)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchInvestmentBrief")
    }

    private var companyBriefMembership: CandidateMembershipData? {
        guard let membership = selectedMembership,
              membership.state == .tracked,
              parsedSymbol?.canonical == membership.symbol else { return nil }
        return membership
    }

    private var companyBriefWorkspace: FrozenResearchEvidenceWorkspace? {
        guard let membership = companyBriefMembership,
              let workspace = frozenResearchEvidenceWorkspace.envelope,
              workspace.status == "available",
              workspace.requestedActorId == membership.actorId,
              workspace.membershipId == membership.id,
              workspace.requestedSymbol == membership.symbol,
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.membershipState == membership.state.rawValue,
              workspace.data?.target.symbol == membership.symbol else { return nil }
        return workspace
    }

    private var companyBriefReasoning: ResearchOperatingReasoning? {
        guard let workspace = companyBriefWorkspace,
              let reasoning = workspace.data?.operatingReasoning,
              reasoning.matches(workspace),
              companyBriefReasoningFactsCurrent(reasoning, workspace: workspace) else { return nil }
        return reasoning
    }

    private var companyBriefHistoricalReasoning: ResearchOperatingReasoning? {
        guard let workspace = companyBriefWorkspace,
              let reasoning = workspace.data?.operatingReasoning,
              reasoning.matches(workspace),
              !companyBriefReasoningFactsCurrent(reasoning, workspace: workspace) else { return nil }
        return reasoning
    }

    private func companyBriefReasoningFactsCurrent(
        _ reasoning: ResearchOperatingReasoning,
        workspace: FrozenResearchEvidenceWorkspace
    ) -> Bool {
        let materials = workspace.data?.materials ?? []
        return !reasoning.facts.isEmpty && reasoning.facts.allSatisfy { fact in
            materials.contains { material in
                material.id == fact.source.materialId
                    && material.revision == fact.source.revision
                    && material.contentFingerprint == fact.source.contentFingerprint
                    && material.revisionState == "current"
                    && material.freshness == "fresh"
                    && parseInstant(material.validUntil).map({ $0 > Date() }) == true
            }
        }
    }

    private var companyBriefProviderReference: ResearchProviderOperatingReference? {
        guard let membership = companyBriefMembership,
              let reference = companyBriefWorkspace?.data?.providerOperatingReference,
              reference.validates(membership) else { return nil }
        return reference
    }

    private var companyBriefContext: ResearchContextData? {
        guard let membership = companyBriefMembership,
              researchContextWorkspace.hasAvailableContext(for: membership),
              let envelope = researchContextWorkspace.envelope,
              envelope.metadata.freshness == "fresh", !envelope.metadata.stale,
              let data = envelope.data,
              data.currentness.status == "current",
              parseInstant(data.validUntil).map({ $0 > Date() }) == true else { return nil }
        return data
    }

    private var companyBriefFundamentals: ResearchFundamentalsEnvelope? {
        guard let membership = companyBriefMembership,
              let envelope = researchFundamentalWorkspace.envelope,
              envelope.status == "available", envelope.requestedActorId == membership.actorId,
              envelope.membershipId == membership.id,
              envelope.membershipVersion == membership.version,
              envelope.symbol == membership.symbol else { return nil }
        return envelope
    }

    private var companyBriefValuation: ResearchValuationScenariosEnvelope? {
        guard let membership = companyBriefMembership,
              let envelope = researchValuationScenarioWorkspace.envelope,
              envelope.status == "available", envelope.requestedActorId == membership.actorId,
              envelope.membershipId == membership.id,
              envelope.membershipVersion == membership.version,
              envelope.membershipState == membership.state.rawValue,
              envelope.symbol == membership.symbol else { return nil }
        return envelope
    }

    private func companyBriefProviderPeriods(
        _ reference: ResearchProviderOperatingReference,
        workspace: FrozenResearchEvidenceWorkspace
    ) -> [ProviderOperatingPeriod] {
        let materials = workspace.data?.materials ?? []
        return Array(reference.periods.sorted { $0.periodEnd > $1.periodEnd }.filter { period in
            !period.values.isEmpty && !period.materialMatches.isEmpty
                && period.materialMatches.allSatisfy { match in
                    materials.contains {
                        $0.id == match.id && $0.revision == match.revision
                            && $0.contentFingerprint == match.contentFingerprint
                            && $0.sourceVersion == match.sourceVersion
                            && $0.revisionState == "current"
                            && $0.freshness == "fresh"
                            && parseInstant($0.validUntil).map({ $0 > Date() }) == true
                    }
                }
        }.prefix(2))
    }

    @ViewBuilder
    private func companyBusinessReadout() -> some View {
        if let membership = companyBriefMembership {
            let reasoning = companyBriefReasoning
            let reference = companyBriefProviderReference
            let providerPeriods = reference.flatMap { ref in
                companyBriefWorkspace.map { companyBriefProviderPeriods(ref, workspace: $0) }
            } ?? []
            let context = companyBriefContext
            let contextFacts = context?.selectedFacts.filter {
                $0.selectedSymbol == membership.symbol && $0.symbol == membership.symbol
                    && parseInstant($0.validUntil).map({ $0 > Date() }) == true
            } ?? []
            let contextKpis = context?.operatingKpis.filter {
                $0.selectedSymbol == membership.symbol
                    && parseInstant($0.validUntil).map({ $0 > Date() }) == true
            } ?? []
            let hasContextNumbers = contextFacts.contains { $0.value != nil }
                || contextKpis.contains { $0.valueStatus == "reported" && $0.value != nil }
            let fundamentals = companyBriefFundamentals
            let fundamentalValues = fundamentals?.values.filter {
                $0.membershipId == membership.id && $0.symbol == membership.symbol
                    && $0.valueStatus == "reported" && $0.isCurrentlyUsable
                    && $0.source.materialRevisionState == "current"
                    && $0.source.freshness == "fresh"
                    && parseInstant($0.source.validUntil).map({ $0 > Date() }) == true
            }.sorted { $0.periodEnd > $1.periodEnd } ?? []
            Text("当前已存公司研究 · \(membership.symbol)")
                .font(.headline)
            Text("以下逐项读取当前研究成员的资料与 Owner 情景；它们尚未形成新的有效 AI 报告或生效投资决定。")
                .font(.caption).foregroundStyle(.secondary)
            if let reasoning {
                if companyBriefWorkspace?.isFreshForCurrentResearch == false {
                    Text("整体研究工作区仍因其他资料过期；以下经营解释仅使用逐项核对为当前有效的来源，旧冻结包与正式报告仍须更新。")
                        .font(.caption).foregroundStyle(OwnerExperienceStyle.warning)
                }
                OperatingChangeToJudgmentView(reasoning: reasoning)
                    .accessibilityIdentifier("companyReadoutDisclosureToJudgment")
                let changedFact = reasoning.publicResearchChangeFact
                researchBriefLine(
                    title: "发生了什么",
                    value: reasoning.publicResearchChangeLabel.map { label in
                        label + (changedFact.map { " · " + $0.text } ?? " · 对应经营事实原件尚待核对")
                    } ?? reasoning.fact.text,
                    identifier: "companyReadoutChange"
                )
                researchBriefLine(
                    title: "当前解释草稿的主事实",
                    value: reasoning.fact.text,
                    identifier: "companyReadoutFact"
                )
                Text("来源：已保存材料 #\(reasoning.fact.source.materialId) · \(reasoning.fact.source.publishedAt.prefix(10)) · \(reasoning.fact.period.end) 期 · \(reasoning.fact.source.assertionVerificationStatus)；解释由确定性研究草稿生成。")
                    .font(.caption).foregroundStyle(.secondary)
                researchBriefLine(
                    title: "经营含义（解释）",
                    value: reasoning.researchUpdate?.change?.triggerType == "verification_upgrade"
                        ? "本次仅升级来源核对，数值与口径未变；没有新增经营传导。"
                        : changedFact == nil || changedFact?.id == reasoning.fact.id
                            ? reasoning.operatingMeaning.text
                            : "本次资料变化涉及另一个指标；当前解释草稿不能直接套用，传导仍待核查。",
                    identifier: "companyReadoutMeaning"
                )
                if let impact = reasoning.thesisImpact,
                   reasoning.researchUpdate?.change?.triggerType != "verification_upgrade",
                   changedFact == nil || changedFact?.id == reasoning.fact.id {
                    researchBriefLine(
                        title: "对原报告条件的草稿评估",
                        value: impact.explanation,
                        identifier: "companyReadoutThesisImpact"
                    )
                }
            } else {
                Text(companyBriefWorkspace?.data?.operatingReasoning != nil
                    ? "已存经营解释所用事实材料未全部核对为当前有效；这里只展示仍可独立核对的数值与档案，不沿用旧解释。"
                    : "当前没有可核对的经营解释草稿；下列已存数值只说明来源所记录的内容，不能单独证明因果或利润改善。")
                    .font(.caption).foregroundStyle(.secondary)
                if let historical = companyBriefHistoricalReasoning {
                    DisclosureGroup("查看过期的经营解释与原假设评估") {
                        OperatingChangeToJudgmentView(reasoning: historical, historicalReference: true)
                            .accessibilityIdentifier("companyHistoricalChangeToJudgment")
                        researchBriefLine(
                            title: "当时记录的变化",
                            value: historical.publicResearchChangeLabel.map { label in
                                label + (historical.publicResearchChangeFact.map { " · " + $0.text } ?? " · 对应原件未定位")
                            } ?? historical.fact.text,
                            identifier: "companyReadoutHistoricalChange"
                        )
                        researchBriefLine(
                            title: "当时的经营解释",
                            value: historical.publicResearchChangeFact == nil
                                || historical.publicResearchChangeFact?.id == historical.fact.id
                                ? historical.operatingMeaning.text
                                : "当时变化指标与解释主事实不同；不合并为因果结论。",
                            identifier: "companyReadoutHistoricalMeaning"
                        )
                        if let impact = historical.thesisImpact,
                           historical.publicResearchChangeFact == nil
                            || historical.publicResearchChangeFact?.id == historical.fact.id {
                            Text("当时对原报告条件的草稿评估：\(impact.explanation)")
                                .font(.caption)
                        }
                        Text("原材料 #\(historical.fact.source.materialId) · \(historical.fact.period.end) 期；此解释不作为当前事实或判断。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !providerPeriods.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(providerPeriods) { period in
                        Text("OpenD 经营参考 · \(period.financialType == "Q6" ? "累计半年" : "年度")截至 \(period.periodEnd)")
                            .font(.callout.weight(.semibold))
                        ForEach(period.values) { value in
                            Text("\(value.displayName)：原值 \(value.rawValue) \(value.currencyCode) · \(value.periodText)")
                                .font(.callout)
                        }
                        Text("捕获 #\(period.captureId ?? "未知") · 材料 \(period.materialMatches.map(\.id).joined(separator: ", "))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text("第三方原值，发行人原文与重述可比性未核实；年度与累计半年不能直接比较或推定增速。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("companyReadoutProviderValues")
            }
            if let fundamentals, !fundamentalValues.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Text("发行人结构化原值 · 保存时人工录入")
                        .font(.callout.weight(.semibold))
                    ForEach(Array(fundamentalValues.prefix(3))) { value in
                        companyFundamentalValueRow(value, coverage: fundamentals.financialCoverage)
                    }
                    if fundamentalValues.count > 3 {
                        DisclosureGroup("查看其余结构化原值（\(fundamentalValues.count - 3)）") {
                            ForEach(Array(fundamentalValues.dropFirst(3))) { value in
                                companyFundamentalValueRow(value, coverage: fundamentals.financialCoverage)
                            }
                        }
                    }
                }
                .accessibilityIdentifier("companyReadoutFundamentalValues")
            }
            if providerPeriods.isEmpty && fundamentalValues.isEmpty && !hasContextNumbers {
                Text("当前没有可用的经营数值；请到资料页核对已保存 OpenD 或发行人原文。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if !contextFacts.isEmpty || !contextKpis.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("公司档案中的原文事实与经营指标")
                        .font(.callout.weight(.semibold))
                    ForEach(Array(contextFacts.prefix(1))) { fact in
                        Text("公司事实 · \(fact.metric)：\(fact.value ?? "待核实") \(fact.unit) · \(fact.periodEnd ?? fact.asOf)")
                            .font(.callout)
                    }
                    ForEach(Array(contextKpis.filter { $0.valueStatus == "reported" }.prefix(2))) { kpi in
                        Text("经营 KPI · \(kpi.metric)：\(kpi.value ?? "待核实") \(kpi.unit) · \(kpi.periodStart)–\(kpi.periodEnd)")
                            .font(.callout)
                    }
                    DisclosureGroup("查看全部已存事实与 KPI（\(contextFacts.count + contextKpis.count)）") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(contextFacts) { fact in companyContextFactRow(fact) }
                            ForEach(contextKpis) { kpi in companyContextKpiRow(kpi) }
                            Text("所有数值均按原页的指标、单位和期间展示。活跃账户若在原文中为账户数，不等于独立人数。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityIdentifier("companyReadoutSavedContextFacts")
            }
            if let context {
                if let driver = context.industryDrivers.first {
                    researchBriefLine(
                        title: "行业背景（已存研究档案）",
                        value: driver.statement,
                        identifier: "companyReadoutIndustry"
                    )
                }
            }
            companyValuationReadout(membership: membership)
            researchBriefLine(
                title: "价格使用条件",
                value: "上列每股数值是 Owner 假设下的研究情景，须与同币种、同日期口径的当前报价另行核对；当前没有从这些情景自动生成买卖阈值。",
                identifier: "companyReadoutPriceCondition"
            )
            researchBriefLine(
                title: "主要风险与反证",
                value: reasoning?.thesisUpdate?.counterevidence.first
                    ?? context?.industryDrivers.first(where: { $0.impact == "adverse" })?.statement
                    ?? reference?.ownerContext?.counterEvidence.first?.conditionText
                    ?? "当前没有已保存的明确反证；需要核对风险来源，不能按零风险处理。",
                identifier: "companyReadoutRisk"
            )
            let gaps = [reasoning?.unknown.text, context?.unknowns.first, reference?.gaps.first]
                .compactMap { $0 }.filter { !$0.isEmpty }.prefix(2).joined(separator: "；")
            let nextQuestion = reasoning?.nextResearchQuestion
                ?? reference?.ownerContext?.questions.first?.question
                ?? "核对最新公司原文与估值假设。"
            researchBriefLine(
                title: "缺口与下一问题",
                value: "\(gaps.isEmpty ? "当前缺口尚未记录。" : gaps)\n下一问题：\(nextQuestion)",
                identifier: "companyReadoutNextQuestion"
            )
            if let history = decisionReviewHistory,
               history.requestedSymbol == membership.symbol,
               history.metadata.freshness == "fresh", !history.metadata.stale,
               let check = history.checks.first(where: { $0.isOrdinaryPriorJudgmentSource }) {
                researchBriefLine(
                    title: "已有普通人工判断（历史记录）",
                    value: "\(check.checkedAt.prefix(10)) · \(check.userFinalDecision ?? "未填写")",
                    identifier: "companyReadoutManualJudgment"
                )
                if let question = check.reviews.first?.reviewLearning.snapshot?.nextResearchQuestion,
                   !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("最近复盘留下的问题：\(question)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack {
#if OWNER_CLIENT
                Button("核对资料") { researchActions.workflow(.materials) }
                Button("查看估值") { researchActions.workflow(.valuation) }
                Button("记录普通判断") { researchActions.workflow(.manualResearch) }
#else
                Button("核对资料") { selectedDecisionLayer = .evidence; selectedEvidenceWorkspace = .documents }
                Button("查看估值") { selectedDecisionLayer = .evidence; selectedEvidenceWorkspace = .valuation }
                Button("记录判断") { selectedDecisionLayer = .decision }
#endif
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("companyReadoutNextActions")
        } else {
            Text("请选择当前跟踪的公司，读取该成员的已保存经营、估值和风险资料。")
                .font(.callout).foregroundStyle(.secondary)
        }
    }

    private func companyFundamentalValueRow(
        _ value: ResearchFundamentalValueData,
        coverage: ResearchFinancialCoverage
    ) -> some View {
        let matchingPeriods = coverage.periods.filter { period in
            period.periodEnd == value.periodEnd
                && (value.periodKind == "instant" || period.periodStart == value.periodStart)
        }
        let periodType = matchingPeriods.count == 1
            ? (matchingPeriods[0].periodType == "annual" ? "年度" : "中期")
            : "期间类型未单列"
        let period = value.periodKind == "instant"
            ? "截至 \(value.periodEnd) 的时点"
            : "\(value.periodStart ?? "起日未记录") 至 \(value.periodEnd)"
        let scope = switch value.scope {
        case "consolidated": "合并口径"
        case "parent_company": "母公司口径"
        case "segment": "分部口径"
        default: "范围未定"
        }
        let verification = switch value.provenance.verificationStatus {
        case "source_text_verified": "原文数字已核对；结构与口径另核"
        case "owner_confirmed": "Owner 已确认口径"
        case "verified": "材料记录为已核验"
        default: "待核验"
        }
        let unit = value.assertion?.unit
            ?? ResearchFundamentalMetricCatalog.option(for: value.metric)?.unit
            ?? "currency"
        let valueUnit = switch unit {
        case "ratio": "比例原值"
        case "vehicles": "× \(value.unitScale) 辆"
        case "shares": "× \(value.unitScale) 股"
        case "currency_per_vehicle": "× \(value.unitScale) \(value.currency)/辆"
        default: "× \(value.unitScale) \(value.currency)"
        }
        let isGuidance = value.assertion?.category == "guidance"
        return VStack(alignment: .leading, spacing: 3) {
            Text("\(isGuidance ? "管理层目标／指引（非已实现结果）" : "已保存原值") · \(fundamentalMetricTitle(value.metric)) · \(value.value ?? "待核实") \(valueUnit)")
                .font(.callout)
            Text("\(periodType) · \(period) · \(scope)\((value.assertion?.businessScope).map { " · \($0)" } ?? "")")
                .font(.caption).foregroundStyle(.secondary)
            if isGuidance, let statement = value.assertion?.guidance?.statement,
               !statement.isEmpty {
                Text("原声明：\(statement)").font(.caption).foregroundStyle(.secondary)
            }
            if isGuidance, let limitation = value.assertion?.limitation,
               !limitation.isEmpty {
                Text("限制：\(limitation)").font(.caption).foregroundStyle(.secondary)
            }
            Text("\(verification) · 材料 #\(value.source.materialId)\(value.source.pageNumber.map { " 第 \($0) 页" } ?? "")")
                .font(.caption).foregroundStyle(.secondary)
            if value.comparability != "comparable" {
                Text("可比性待核对：\(value.comparabilityReason ?? value.comparability)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func companyContextFactRow(_ fact: ResearchContextNumericFact) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("公司事实 · \(fact.metric)").font(.callout.weight(.semibold))
            Text("原值：\(fact.value ?? "待核实") \(fact.unit)\(fact.currency.map { " · \($0)" } ?? "")")
                .font(.callout)
            Text("期间：\(fact.periodStart.map { "\($0) 至 " } ?? "")\(fact.periodEnd ?? fact.asOf) · 来源：\(fact.citation.sourceLabel)")
                .font(.caption).foregroundStyle(.secondary)
            if case .pdf(let citation) = fact.citation, citation.sourceMembership == nil {
                Button("打开原 PDF 第 \(citation.pageNumber) 页") {
                    Task { await openResearchContextCitation(citation) }
                }
                .font(.caption)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func companyContextKpiRow(_ kpi: ResearchOperatingKpi) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(kpi.category == "price" ? "价格趋势" : "经营 KPI") · \(kpi.metric)")
                .font(.callout.weight(.semibold))
            Text("原值：\(kpi.valueStatus == "reported" ? kpi.value ?? "待核实" : "明确未知") \(kpi.unit)")
                .font(.callout)
            Text("期间：\(kpi.periodStart) 至 \(kpi.periodEnd) · 来源：PDF #\(kpi.citation.documentId) 第 \(kpi.citation.pageNumber) 页")
                .font(.caption).foregroundStyle(.secondary)
            Button("打开原 PDF 第 \(kpi.citation.pageNumber) 页") {
                Task { await openResearchContextCitation(kpi.citation) }
            }
            .font(.caption)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func companyValuationReadout(membership: CandidateMembershipData) -> some View {
        let valuation = companyBriefValuation
        let providerPe = valuation?.providerScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        let manualPe = valuation?.scenarioSets.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                && $0.calculation.method.id == "discounted_forward_metric_multiple_user_scenario"
        }.max { $0.createdAt < $1.createdAt }
        let providerFcff = valuation?.providerFcffScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        let manualFcff = valuation?.fcffScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        if let pe = providerPe {
            let input = pe.assumptions.values
            researchBriefLine(
                title: "PE 情景 · Owner 假设",
                value: "OpenD EPS \(pe.providerBasis.eps.periodEnd) · 材料 #\(pe.providerBasis.sourceMaterialId)；基准每股 \(String(format: "%.2f", input.baseMetricPerShare)) \(input.metricCurrency ?? "币种未知")，年增长 \(String(format: "%.1f%%", input.annualGrowthRate * 100))、末期倍数 \(String(format: "%.1f", input.terminalMultiple))、折现率 \(String(format: "%.1f%%", input.annualDiscountRate * 100))。计算每股 \(String(format: "%.2f", pe.calculation.scenarioPresentValuePerShare))；不是目标价，发行人原文未核实。",
                identifier: "companyReadoutPe"
            )
        } else if let pe = manualPe {
            let input = pe.assumptions.values
            researchBriefLine(
                title: "PE 情景 · Owner 假设",
                value: "基准 \(pe.anchor.periodEnd) · 材料 #\(pe.anchor.source.materialId)；每股 \(String(format: "%.2f", input.baseMetricPerShare)) \(input.metricCurrency ?? pe.anchor.currency)，年增长 \(String(format: "%.1f%%", input.annualGrowthRate * 100))、末期倍数 \(String(format: "%.1f", input.terminalMultiple))、折现率 \(String(format: "%.1f%%", input.annualDiscountRate * 100))。计算每股 \(String(format: "%.2f", pe.calculation.scenarioPresentValuePerShare))；不是目标价。",
                identifier: "companyReadoutPe"
            )
        } else {
            Text("PE 情景：当前成员尚无可复算的已保存 Owner 假设。")
                .font(.caption).foregroundStyle(.secondary)
        }
        if let fcff = providerFcff {
            companyFcffLine(input: fcff.assumptions.values, calculation: fcff.calculation,
                            source: "OpenD 材料 #\(fcff.providerReference.materialId) · 第三方未核实")
        } else if let fcff = manualFcff {
            let sources = Array(Set(fcff.historicalOriginals.facts.map(\.materialId))).sorted().joined(separator: ", ")
            companyFcffLine(input: fcff.assumptions.values, calculation: fcff.calculation,
                            source: "已保存原件材料 \(sources)")
        } else {
            Text("FCFF 情景：当前成员尚无可复算的已保存 Owner 预测与权益桥。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func companyFcffLine(
        input: FcffScenarioInput,
        calculation: FcffScenarioCalculation,
        source: String
    ) -> some View {
        researchBriefLine(
            title: "FCFF 情景 · Owner 假设",
            value: "\(source)；历史年度截至 \(input.historicalAnnualPeriodEnd)，余额参考 \(input.balanceReferenceDate)，估值截止 \(input.valuationCutoff)。WACC \(String(format: "%.1f%%", input.wacc * 100))、永续增长 \(String(format: "%.1f%%", input.terminalGrowthRate * 100))；计算每股 \(String(format: "%.2f", calculation.commonEquityValuePerShare)) \(calculation.currency)。含预测与分类权益桥，不是报价或目标价。",
            identifier: "companyReadoutFcff"
        )
    }
    @ViewBuilder
    private func researchTechnicalBriefContent(_ technical: WeinsteinTechnicalAnalysisEnvelope) -> some View {
        let lead = pendingNoticeLead.flatMap { $0.item.symbol == technical.symbol ? $0 : nil }
        Text("当前判断")
            .font(.headline)
        Text(researchTechnicalJudgment(technical))
            .font(.callout.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("researchBriefJudgment")
        Label("真实周线 · 分析日 \(technical.analysisAsOf) · 完成周 \(technical.completedWeekEnd ?? technical.analysisAsOf)", systemImage: "checkmark.seal.fill")
            .font(.caption.weight(.semibold))
            .foregroundStyle(OwnerExperienceStyle.success)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("researchBriefFreshness")
        VStack(alignment: .leading, spacing: 4) {
            Text("为什么")
                .font(.caption.weight(.semibold))
            ForEach(Array(researchTechnicalDrivers(technical).enumerated()), id: \.offset) { index, driver in
                Text("\(index + 1). \(driver)")
                    .font(.caption)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("researchBriefDrivers")
        researchBriefLine(
            title: "估值与价格条件",
            value: researchTechnicalPriceCondition(technical),
            identifier: "researchBriefValuation"
        )
        researchBriefLine(
            title: "最大风险与推翻条件",
            value: researchTechnicalRisk(technical),
            identifier: "researchBriefRisk"
        )
        researchBriefLine(
            title: "什么会让我改判",
            value: "若行业继续落后、个股跌破支撑，且公司事实转弱，我会改判；技术周线不能代替公司反证。",
            identifier: "researchBriefCounterevidence"
        )
        researchBriefLine(
            title: "相对上一版",
            value: "首次读取当前完成周线；尚无新的公司来源可比较。",
            identifier: "researchBriefChange"
        )
        VStack(alignment: .leading, spacing: 6) {
            Text("唯一下一步")
                .font(.caption.weight(.semibold))
            Text(lead.map { "核对《\($0.item.title)》原文是否改变经营与风险判断。" }
                ?? "到市场选择一条最新公司来源，核对原文后再形成基本面判断。")
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(4)
            if let lead, let url = lead.item.externalURL {
                Link("打开当前来源", destination: url)
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("researchBriefSourceLink")
                Text("\(lead.item.source) · 发布 \(lead.item.publishedAt) · 读取 \(lead.fetchedAt)；当前仍是待人工核验线索，浏览不会写入研究档案。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Button {
                    selectedTab = .market
                } label: {
                    Label("到市场选择最新来源", systemImage: "arrow.right.circle")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(lead.map {
            "待核验来源：\($0.item.title)；发布 \($0.item.publishedAt)；读取 \($0.fetchedAt)"
        } ?? "真实周线已读取；公司来源待核对")
        .accessibilityIdentifier("researchBriefSource")
    }
    func researchTechnicalJudgment(_ value: WeinsteinTechnicalAnalysisEnvelope) -> String {
        switch value.stockStage {
        case "STAGE_2":
            "周线处于第 2 阶段，可继续研究；正式投资判断仍需最新公司事实与估值支持。"
        case "STAGE_3":
            "周线进入转弱阶段，先核对最新公司事实；在结构修复前保持谨慎。"
        case "STAGE_4":
            "周线仍在第 4 阶段，先核对最新公司事实；在趋势修复前不升级为正面判断。"
        case "TRANSITION":
            "周线处于转换期，先核对最新公司事实；不把短期变化当成趋势确认。"
        case "UNKNOWN":
            "周线证据不足，先补齐同一分析日的个股、恒指和行业周线；暂不判断阶段。"
        default:
            "周线阶段尚未确认；先核对完成周线和最新公司来源。"
        }
    }
    func researchTechnicalDrivers(_ value: WeinsteinTechnicalAnalysisEnvelope) -> [String] {
        let distance = value.priceVsMa30wPercent.map { String(format: "%+.2f%%", $0) } ?? "尚未算出距离"
        return [
            "个股处于\(researchTechnicalStage(value.stockStage))，30 周均线\(researchTechnicalDirection(value.ma30wDirection))，周收盘距均线 \(distance)。",
            "行业处于\(researchTechnicalStage(value.sectorStage))，相对市场\(researchTechnicalStrength(value.sectorStrength))。",
            "个股相对强弱\(researchTechnicalStrength(value.relativeStrengthStatus))，最近一周量能\(researchTechnicalStrength(value.volumeConfirmation))。"
        ]
    }
    func researchTechnicalPriceCondition(_ value: WeinsteinTechnicalAnalysisEnvelope) -> String {
        let condition: String
        if let close = value.weeklyChart.last?.close, let zone = value.supportZones.first {
            let range = "\(String(format: "%.2f", zone.lower))–\(String(format: "%.2f", zone.upper))"
            condition = close < zone.lower
                ? "完成周收 \(String(format: "%.2f", close)) 低于此前支撑区 \(range)；重新站回并守住才算结构改善。"
                : close <= zone.upper
                    ? "完成周收 \(String(format: "%.2f", close)) 位于支撑区 \(range)；后续完成周线须守住。"
                    : "技术支撑区 \(range)；后续完成周线跌破会削弱判断。"
        } else {
            condition = "当前完成周线没有可用支撑区，价格结构条件待核对。"
        }
        return "\(condition) \(researchCurrentValuationCondition(symbol: value.symbol)) 技术支撑不是估值；当前报价的币种与时点未同情景核对，不计算涨跌空间或目标价。"
    }

    private func researchCurrentValuationCondition(symbol: String) -> String {
        guard let membership = companyBriefMembership, membership.symbol == symbol else {
            return "当前公司估值身份未确认。"
        }
        if researchValuationScenarioWorkspace.isLoading { return "估值情景正在读取。" }
        guard let valuation = companyBriefValuation else {
            return "估值情景尚未读取或当前不可用，估值状态未知。"
        }
        let providerPe = valuation.providerScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        let manualPe = valuation.scenarioSets.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
                && $0.calculation.method.id == "discounted_forward_metric_multiple_user_scenario"
        }.max { $0.createdAt < $1.createdAt }
        let providerFcff = valuation.providerFcffScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        let manualFcff = valuation.fcffScenarioSets?.filter {
            $0.membershipId == membership.id && $0.membershipVersionAtWrite == membership.version
                && $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
        }.max { $0.createdAt < $1.createdAt }
        var readings: [String] = []
        if let pe = providerPe {
            readings.append("OpenD 未核实原值与 Owner 假设的 PE 情景 \(String(format: "%.2f", pe.calculation.scenarioPresentValuePerShare)) \(pe.assumptions.values.metricCurrency ?? "币种待核")/股")
        } else if let pe = manualPe {
            readings.append("已存材料与 Owner 假设的 PE 情景 \(String(format: "%.2f", pe.calculation.scenarioPresentValuePerShare)) \(pe.assumptions.values.metricCurrency ?? pe.anchor.currency)/股")
        }
        if let fcff = providerFcff {
            readings.append("OpenD 未核实原值与 Owner 预测的 FCFF 情景 \(String(format: "%.2f", fcff.calculation.commonEquityValuePerShare)) \(fcff.calculation.currency)/股")
            if manualFcff == nil { readings.append("当前无可复算的发行人原件 FCFF 情景") }
        } else if let fcff = manualFcff {
            readings.append("已存原件与 Owner 预测的 FCFF 情景 \(String(format: "%.2f", fcff.calculation.commonEquityValuePerShare)) \(fcff.calculation.currency)/股")
        }
        if readings.isEmpty {
            let hasHistory = !valuation.scenarioSets.isEmpty
                || !(valuation.providerScenarioSets ?? []).isEmpty
                || !(valuation.fcffScenarioSets ?? []).isEmpty
                || !(valuation.providerFcffScenarioSets ?? []).isEmpty
            return hasHistory
                ? "已存估值情景当前失效或不可复算；未形成可用估值条件。"
                : "当前尚无已保存且可复算的估值情景。"
        }
        return "当前可复算的有限参考：\(readings.joined(separator: "；"))。不是现价，也不代表完整估值或冻结条件满足。"
    }
    func researchTechnicalRisk(_ value: WeinsteinTechnicalAnalysisEnvelope) -> String {
        let risk = "最大风险：个股\(researchTechnicalStage(value.stockStage))、行业\(researchTechnicalStage(value.sectorStage))，且行业相对市场\(researchTechnicalStrength(value.sectorStrength))。"
        if value.stockStage == "STAGE_2" {
            return "\(risk) 若周线跌破 30 周均线并破坏支撑，当前判断失效。"
        }
        return "\(risk) 只有周线转强并重新站稳 30 周均线，且公司事实未转弱，当前谨慎判断才会改变。"
    }
    func researchTechnicalStage(_ value: String) -> String {
        switch value {
        case "STAGE_1": "第 1 阶段"
        case "STAGE_2": "第 2 阶段"
        case "STAGE_3": "第 3 阶段"
        case "STAGE_4": "第 4 阶段"
        case "TRANSITION": "转换期"
        default: "阶段未确认"
        }
    }
    func researchTechnicalDirection(_ value: String) -> String {
        ["RISING": "上升", "FLAT": "走平", "FALLING": "下降"][value] ?? "未确认"
    }
    func researchTechnicalStrength(_ value: String) -> String {
        [
            "LEADING": "领先", "IMPROVING": "改善", "NEUTRAL": "中性", "WEAKENING": "转弱",
            "LAGGING": "落后", "STRENGTHENING": "转强", "WEAK": "偏弱", "NORMAL": "正常",
            "STRONG": "较强", "VERY_STRONG": "很强"
        ][value] ?? "未确认"
    }
    @ViewBuilder
    private func researchInvestmentBriefContent(
        report: TwoLayerReportData,
        advice: TwoLayerAdvice,
        research: TwoLayerResearch,
        step: DailyDecisionNextStep
    ) -> some View {
        let drivers = researchBriefDrivers(report: report, research: research)
        let change = researchBriefChange(report: report)
            ?? researchBriefNonEmpty(advice.versionChange)?.researchBriefOwnerCondition(
                replacement: "首版研究结果；暂无上一版可比较。"
            )
        let affectedVariables = researchBriefAffectedVariables(report: report)
        // 首屏只保留可读的紧凑判断预览；完整判断、驱动、期限、变化与推翻条件放在显式展开里。
        researchBriefPreviewLine(
            title: "当前判断",
            value: advice.conclusion,
            identifier: "researchBriefJudgment",
            maxLines: 4
        )
        researchBriefPreviewLine(
            title: "价格条件",
            value: researchBriefPrice(advice),
            identifier: "researchBriefValuation",
            maxLines: 2
        )
        researchBriefPreviewLine(
            title: "最大风险",
            value: researchBriefRisk(advice: advice, research: research),
            identifier: "researchBriefRisk",
            maxLines: 2
        )
        researchBriefPreviewLine(
            title: "唯一下一步",
            value: research.nextValidationQuestions.first ?? "重新核对当前来源。",
            identifier: "researchPrimaryNextAction",
            maxLines: 2
        )
        researchBriefSource(report: report, research: research)
        DisclosureGroup("展开完整判断", isExpanded: $isResearchBriefFullJudgmentExpanded) {
            VStack(alignment: .leading, spacing: 10) {
                Text("AI 根据所选资料归纳与分析，非发行人原话；解释与推断请核对引用来源。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                researchBriefReadableLine(
                    title: "完整判断",
                    value: advice.conclusion,
                    identifier: "researchBriefJudgmentFull"
                )
                researchBriefReadableLine(
                    title: "适用期限",
                    value: researchBriefValidityText(report: report, advice: advice),
                    identifier: "researchBriefApplicableUntil"
                )
                VStack(alignment: .leading, spacing: 4) {
                    Text("为什么")
                        .font(.callout.weight(.semibold))
                    if drivers.isEmpty {
                        Text("目前未确认：报告没有可用的核心驱动。")
                            .font(.callout)
                    } else {
                        ForEach(Array(drivers.enumerated()), id: \.offset) { index, driver in
                            Text("\(index + 1). \(driver)")
                                .font(.callout)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("researchBriefDrivers")
                researchBriefReadableLine(
                    title: "情景条件",
                    value: researchBriefScenarioConditions(advice),
                    identifier: "researchBriefScenarioConditions"
                )
                researchBriefReadableLine(
                    title: "完整价格条件",
                    value: researchBriefPrice(advice),
                    identifier: "researchBriefValuationFull"
                )
                // 未绑定结构化变量不等于缺少经营证据，缺省时隐藏该行，诊断与底层数据保持不变。
                if !affectedVariables.isEmpty {
                    researchBriefReadableLine(
                        title: "受影响的关键变量",
                        value: affectedVariables.map(researchBriefVariableLabel).joined(separator: "、"),
                        identifier: "researchBriefAffectedVariables"
                    )
                }
                researchBriefReadableLine(
                    title: "最大风险、反证与推翻条件",
                    value: "风险：\(researchBriefRisk(advice: advice, research: research))\n反证：\(researchBriefCounterevidence(research))\n推翻条件：\(researchBriefInvalidation(report: report, advice: advice))",
                    identifier: "researchBriefRiskFull"
                )
                researchBriefReadableLine(
                    title: "相对上一版",
                    value: change ?? "目前未确认：没有可比较的上一版。",
                    identifier: "researchBriefChange"
                )
                researchBriefReadableLine(
                    title: "下一步只做什么",
                    value: research.nextValidationQuestions.first ?? "重新核对当前来源。",
                    identifier: "researchPrimaryNextActionFull"
                )
            }
            .padding(.top, 8)
        }
        .accessibilityIdentifier("researchBriefFullJudgment")
        DisclosureGroup("研究问题、变化比较与复核") {
            researchOwnerStatusCard(report: report)
            researchOutcomeImpactBrief(report: report, advice: advice, research: research, step: step)
            researchDecisionQuestionBrief(report: report, advice: advice, research: research)
        }
    }

    /// 首屏预览：可读字号 + 显式行数上限；完整原文在“展开完整判断”里，不做 AI 摘要。
    private func researchBriefPreviewLine(
        title: String,
        value: String,
        identifier: String,
        maxLines: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.callout.weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.textSecondary)
            Text(value.researchInvestorWording)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(maxLines)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    private func researchBriefReadableLine(title: String, value: String, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.callout.weight(.semibold))
            Text(value.researchInvestorWording)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }
    @ViewBuilder
    private func researchOutcomeImpactBrief(
        report: TwoLayerReportData,
        advice: TwoLayerAdvice,
        research: TwoLayerResearch,
        step: DailyDecisionNextStep
    ) -> some View {
        let reports = selectedMembershipResearchReports
        let previous = reports.previousReport(before: report)
        let summary = report.revisionSummary(previous: previous)
        let judgmentSections = [
            "结论", "置信度", "适用期限", "时间视角", "长期观点与条件",
            "中短期观点与条件", "长短期冲突", "估值与技术事实", "风险", "反证"
        ]
        let judgmentChanges = summary.changedSections.filter(judgmentSections.contains)
        let affected = judgmentChanges.isEmpty
            ? researchBriefAffectedVariables(report: report).map(researchBriefVariableLabel)
            : judgmentChanges.map(researchOutcomeConditionLabel)
        let drivers = researchBriefDrivers(report: report, research: research)
        VStack(alignment: .leading, spacing: 4) {
            Text("研究结果对判断的影响")
                .font(.headline)
            HStack(alignment: .top, spacing: 8) {
                researchBriefSource(report: report, research: research)
                    .frame(maxWidth: .infinity, alignment: .leading)
                researchBriefNextAction(step)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(!researchBriefReportIsStale(report)
                     ? "当前有效 · \(researchBriefFreshness(report))"
                     : researchBriefFreshness(report) + " · 历史结果，请读取当前版本后再复核。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(
                        researchBriefReportIsStale(report)
                            ? OwnerExperienceStyle.warning
                            : OwnerExperienceStyle.success
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchOutcomeFreshness")
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchBriefFreshness")
            Text("来源：研究报告 · 生成/读取 \(compactUtcDateTime(report.createdAt)) · 报告截止 \(compactUtcDateTime(report.payload.cutoffAt))")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchOutcomeSourceMetadata")
            researchOutcomeCompactLine(
                title: "问题是否已回答",
                value: researchBriefReportIsStale(report)
                    ? "上次有效结果曾形成新答案；当前已过期，需要新来源重新核对。"
                    : previous == nil
                        ? "已形成首版研究结果；没有上一版问题可比较。"
                        : "已形成新版本答案；仍需核对它是否真正解决上一轮问题。",
                identifier: "researchOutcomeAnswered"
            )
            researchOutcomeCompactLine(
                title: "答案摘要 · 相对上一版新增",
                value: researchOutcomeOwnerSummary(
                    researchBriefNonEmpty(advice.versionChange)
                    ?? researchBriefNonEmpty(report.payload.changeFromPrevious)
                    ?? advice.conclusion
                ).researchBriefOwnerCondition(
                    replacement: "最近研究结果已更新；请核对正式来源。"
                ),
                identifier: "researchOutcomeSummary"
            )
            researchOutcomeCompactLine(
                title: "判断影响",
                value: summary.comparisonUnavailableReason ?? (previous == nil
                    ? "仍未知：这是首版结果，需要你明确复核。"
                    : judgmentChanges.isEmpty
                        ? "判断不变：结论、估值条件、风险和反证没有实质变化。"
                        : "仍未知：最近结果更新了\(judgmentChanges.map(researchOutcomeConditionLabel).joined(separator: "、"))；目前看不出是变好还是变差，请先核对价格条件和最大风险。"),
                identifier: "researchOutcomeJudgmentImpact"
            )
            researchOutcomeCompactLine(
                title: "影响的条件",
                value: affected.isEmpty ? "仍未知：当前结果没有指出受影响的假设或条件。" : affected.joined(separator: "、"),
                identifier: "researchOutcomeAffectedConditions"
            )
            researchOutcomeCompactLine(
                title: "核心驱动",
                value: drivers.isEmpty
                    ? "目前未确认：报告没有可核验的核心驱动。"
                    : drivers.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "；"),
                identifier: "researchOutcomeDrivers"
            )
            researchOutcomeCompactLine(
                title: "估值与价格条件",
                value: researchOutcomeOwnerText(researchBriefPrice(advice)),
                identifier: "researchOutcomeValuation"
            )
            researchOutcomeCompactLine(
                title: "最大风险与推翻条件",
                value: "风险：\(researchOutcomeOwnerText(researchBriefRisk(advice: advice, research: research)))；推翻：\(researchOutcomeOwnerText(researchBriefInvalidation(report: report, advice: advice)))",
                identifier: "researchOutcomeRisk"
            )
            researchOutcomeCompactLine(
                title: "会推翻判断的证据",
                value: researchOutcomeOwnerText(researchBriefCounterevidence(research)),
                identifier: "researchOutcomeCounterevidence"
            )
        }
        .padding(8)
        .background(OwnerExperienceStyle.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchOutcomeImpactBrief")
    }

    @ViewBuilder
    private func researchOwnerStatusCard(report: TwoLayerReportData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            researchOutcomeCompactLine(
                title: "研究结果状态",
                value: researchOwnerDecisionStatus(report: report),
                identifier: "researchOwnerDecisionStatus"
            )
            researchOutcomeCompactLine(
                title: "复核状态",
                value: researchOwnerReviewStatus(),
                identifier: "researchOwnerReviewStatus"
            )
            researchOwnerHistoryAction(report: report)
        }
        .padding(8)
        .background(OwnerExperienceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchOwnerStatusCard")
    }

    private func researchOwnerDecisionStatus(report: TwoLayerReportData) -> String {
        let decision = twoLayerReportWorkspace.envelope?.data?.decisions.first { $0.reportId == report.id }
        if researchBriefReportIsStale(report) {
            switch decision?.decision {
            case "confirmed":
                return "历史版本：你曾于 \(decision?.decidedAt.prefix(10) ?? "此前") 确认；适用期已过，不能当作今天的正式判断。"
            case "rejected":
                return "历史版本：你曾于 \(decision?.decidedAt.prefix(10) ?? "此前") 驳回；不能作为今天的正式判断。"
            default:
                return "历史版本已读取，但适用期已过或来源已陈旧，不能作为今天的正式判断。"
            }
        }
        switch decision?.decision {
        case "confirmed":
            return "已由你确认（\(decision?.decidedAt.prefix(10) ?? "日期待补齐")）；这是研究确认，不是交易或资产写入。"
        case "rejected":
            return "已由你驳回（\(decision?.decidedAt.prefix(10) ?? "日期待补齐")）；等待修订，不能进入正式决定。"
        default:
            return report.status == "evidence_insufficient" || !report.isFormalizable
                ? "证据仍不足，尚未确认；先补齐能重新打开的来源。"
                : "待你明确确认；确认前不会成为正式判断。"
        }
    }

    private func researchOwnerReviewStatus() -> String {
        if let history = decisionReviewHistory,
           history.metadata.freshness != "fresh"
                || history.metadata.stale
                || history.metadata.missing
                || history.metadata.conflict {
            return "复核记录暂不可用；不会假定已经复核。"
        }
        if let review = currentSubmittedReview {
            return "已完成复核：\(reviewOutcomeLabel(review.outcome))（\(review.reviewedAt.prefix(10))）。"
        }
        if let history = decisionReviewHistory,
           history.metadata.provenance == "real",
           history.requestedSymbol == parsedSymbol?.canonical {
            let hasCurrentCheck = history.checks.contains {
                $0.symbol == parsedSymbol?.canonical && $0.researchReportDecision.availability == "preserved"
            }
            return hasCurrentCheck
                ? "尚未完成后续复核；可以打开复核记录填写结果。"
                : "当前股票还没有绑定的复核记录。"
        }
        if decisionReviewMessage != nil {
            return "复核记录暂不可用；不会假定已经复核。"
        }
        return "复核记录正在读取。"
    }

    @ViewBuilder
    private func researchOwnerHistoryAction(report: TwoLayerReportData) -> some View {
        let savedReview = currentSubmittedReview
        Button(savedReview == nil
               ? (researchBriefReportIsStale(report) ? "打开历史报告" : "打开判断与复核")
               : "查看已保存复核") {
            isResearchEvidenceRecordsExpanded = true
            if let savedReview {
                selectedDecisionLayer = .review
                selectedReviewWorkspace = .timeline
                pendingDecisionWorkspaceScrollTarget = decisionReviewSourceAnchor(savedReview.id)
            } else if !researchBriefReportIsStale(report), currentDeepResearchDecision != nil || hasCurrentDecision {
                showDailyDecisionLayer(.review, expandResult: true)
            } else {
                selectedDecisionLayer = .evidence
                selectedEvidenceWorkspace = .brief
                isHistoricalReportsExpanded = !report.isCurrentExact
                pendingDecisionWorkspaceScrollTarget = twoLayerReportFormalDecisionAnchor(report.id)
            }
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("researchOwnerHistoryAction")
    }

    private func researchOutcomeCompactLine(title: String, value: String, identifier: String) -> some View {
        (Text(title).font(.caption.weight(.semibold)) + Text("：\(value.researchInvestorWording)").font(.caption))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(identifier)
    }
    private func researchOutcomeConditionLabel(_ value: String) -> String {
        [
            "结论": "总体判断",
            "置信度": "把握程度",
            "适用期限": "适用时间",
            "时间视角": "观察期限",
            "长期观点与条件": "长期增长条件",
            "中短期观点与条件": "短期走势条件",
            "长短期冲突": "长期和短期观点是否冲突",
            "估值与技术事实": "估值区间和价格走势",
            "风险": "主要风险",
            "反证": "会推翻判断的证据"
        ][value] ?? value
    }
    private func researchOutcomeOwnerText(_ value: String) -> String {
        value
            .replacingOccurrences(of: "UNKNOWN：", with: "目前未确认：")
            .replacingOccurrences(of: "UNKNOWN", with: "目前未确认")
            .replacingOccurrences(of: "绑定 当前", with: "绑定当前")
            .replacingOccurrences(of: "你的 ", with: "你的")
            .replacingOccurrences(of: "与 未确认项", with: "与未确认项")
    }
    private func researchOutcomeOwnerSummary(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"报告 #\d+"#, with: "上一版报告", options: .regularExpression)
            .replacingOccurrences(of: #"current evidence pack #\d+"#, with: "当前证据版本", options: .regularExpression)
            .replacingOccurrences(of: "Owner", with: "你的")
            .replacingOccurrences(of: "UNKNOWN", with: "未确认项")
            .replacingOccurrences(of: "绑定 当前", with: "绑定当前")
            .replacingOccurrences(of: "你的 ", with: "你的")
            .replacingOccurrences(of: "与 未确认项", with: "与未确认项")
    }
    @ViewBuilder
    private func researchDecisionQuestionBrief(
        report: TwoLayerReportData?,
        advice: TwoLayerAdvice?,
        research: TwoLayerResearch?
    ) -> some View {
        let question = advice.flatMap { advice in
            research.map { researchBriefNextObservation(advice: advice, research: $0) }
        } ?? "目前未确认：当前报告还没有明确研究问题，请先完成唯一下一步。"
        let assumption = advice?.assumptions?
            .compactMap { researchBriefNonEmpty($0) }
            .first
        let affectedVariable = report
            .map(researchBriefAffectedVariables(report:))?
            .first
            .map(researchBriefVariableLabel)
        let impact = assumption.map { "当前假设：\($0)" }
            ?? affectedVariable.map { "关键变量：\($0)" }
            ?? "目前未确认：尚未绑定可核验的假设或关键变量。"
        VStack(alignment: .leading, spacing: 8) {
            Text("最值得回答的问题")
                .font(.headline)
            Text(question)
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchBriefNextObservation")
            researchBriefLine(
                title: "为什么影响判断",
                value: "它决定当前改善、维持或恶化条件是否仍成立；证据不足时不会把判断升级为确定结论。",
                identifier: "researchDecisionQuestionWhy"
            )
            researchBriefLine(
                title: "影响什么",
                value: impact,
                identifier: "researchDecisionQuestionImpact"
            )
            researchBriefLine(
                title: "需要什么证据",
                value: researchDecisionQuestionEvidence(research),
                identifier: "researchDecisionQuestionEvidence"
            )
            researchBriefLine(
                title: "做到什么算完成",
                value: "至少一条正式来源能从 App 重新打开；报告明确回答这个问题，并说明相关假设得到支持、被削弱或仍未确认。",
                identifier: "researchDecisionQuestionDone"
            )
            researchBriefLine(
                title: "当前进度",
                value: researchDecisionQuestionProgress(report),
                identifier: "researchDecisionQuestionProgress"
            )
            researchQuestionTaskLink(question: question, report: report)
        }
        .padding(10)
        .background(OwnerExperienceStyle.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchDecisionQuestionBrief")
    }
    private func researchDecisionQuestionEvidence(_ research: TwoLayerResearch?) -> String {
        let internalTerms = ["source_missing", "fingerprint", "binding", "membership", "contextid"]
        if let gap = research?.unknowns
            .compactMap({ researchBriefNonEmpty($0.statement) })
            .first(where: { value in
                !internalTerms.contains(where: { value.lowercased().contains($0) })
            }) {
            return "优先补齐：\(gap)。来源必须能重新打开并核对原文。"
        }
        return "需要一条能直接回答该问题的公司公告、行业统计或官方 PDF，并保留可重新打开的原文入口。"
    }
    private func researchDecisionQuestionProgress(_ report: TwoLayerReportData?) -> String {
        if let task = twoLayerReportWorkspace.pendingSynthesisTask {
            return switch task.status {
            case "pending", "running": "研究任务正在处理；完成前当前判断不变。"
            case "ready_to_absorb": "研究结果已返回，等待你明确采用并重新核对报告。"
            case "succeeded": "研究结果已写入报告，请读取当前版本并复盘问题是否解决。"
            case "failed": "本次研究未完成；旧结果不会冒充新答案。"
            case "canceled": "本次研究已结束；需要你重新确认后才能再开始。"
            default: "任务状态暂未确认；请刷新后再继续。"
            }
        }
        guard let report else {
            return "目前未确认：尚无报告或研究任务，旧股票进度不会保留。"
        }
        if researchBriefReportIsStale(report) {
            return "问题来自上次有效但已过期的报告；需要新来源回答后才能更新判断。"
        }
        if currentDeepResearchDecision?.decision == "confirmed" {
            return "当前报告已确认；这个问题仍等待后续来源验证。"
        }
        if report.status == "evidence_insufficient" {
            return "当前证据不足，问题尚未完成。"
        }
        return "当前报告已读取；问题仍需你完成下一步并核对来源。"
    }
    private func researchQuestionTaskLink(
        question: String,
        report: TwoLayerReportData?
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("来源与研究任务")
                .font(.caption.weight(.semibold))
            Text(researchQuestionTaskStatus(report))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchQuestionTaskSummary")
            Button {
                showDailyDecisionLayer(.evidence)
                selectedEvidenceWorkspace = .brief
                pendingDecisionWorkspaceScrollTarget = "researchQuestionTaskOverview"
            } label: {
                Label("查看来源与研究任务", systemImage: "arrow.triangle.branch")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchQuestionTaskButton")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchQuestionTaskLink")
    }
    private func researchQuestionTaskStatus(_ report: TwoLayerReportData?) -> String {
        if twoLayerReportWorkspace.pendingSynthesisTask != nil {
            return researchDecisionQuestionProgress(report)
        }
        if twoLayerReportWorkspace.draft != nil {
            return "问题和当前来源已放入待确认清单；只有你明确开始后才会创建任务。"
        }
        if currentTwoLayerReportPack?.currentness.status == "current" {
            return "当前来源已冻结；打开后可核对问题和材料，再由你明确开始。"
        }
        if report != nil {
            return "当前问题仍绑定上次有效报告与原始来源；旧证据已过期，补齐新来源前不会创建任务。"
        }
        return "目前未确认：尚无可绑定的报告、来源或研究任务。"
    }
    @ViewBuilder
    func researchQuestionTaskOverview() -> some View {
        let report = researchInvestmentBriefReport
        let advice = report?.payload.adviceLayer
        let research = report?.payload.researchLayer
        let question = advice.flatMap { advice in
            research.map { researchBriefNextObservation(advice: advice, research: $0) }
        } ?? "目前未确认：当前还没有可执行的研究问题。"
        VStack(alignment: .leading, spacing: 8) {
            Text("研究问题与任务")
                .font(.headline)
            Text(question)
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchQuestionTaskOverviewQuestion")
            Text(researchQuestionTaskStatus(report))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchQuestionTaskOverviewStatus")
            if let report, let research {
                researchBriefSource(report: report, research: research)
            }
            if currentTwoLayerReportPack?.currentness.status == "current",
               twoLayerReportWorkspace.pendingSynthesisTask == nil,
               twoLayerReportWorkspace.draft == nil {
                Button {
                    createTwoLayerDraft(researchQuestion: question)
                    pendingDecisionWorkspaceScrollTarget = "deepResearchJourneyStatus"
                } label: {
                    Label("核对并准备同一问题", systemImage: "checkmark.shield")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("prepareResearchQuestionTaskButton")
                Text("这里只准备待确认清单；只有你在下一页明确开始后才会创建任务。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else if report != nil {
                Button {
                    Task { await prepareLimitedResearch() }
                } label: {
                    Label("用已有资料更新研究", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.bordered)
                .disabled(frozenResearchEvidenceWorkspace.isBusy || twoLayerReportWorkspace.isBusy
                    || twoLayerReportWorkspace.draft != nil || twoLayerReportWorkspace.hasActiveSynthesisTask)
                .accessibilityIdentifier("refreshResearchQuestionEvidenceButton")
                Text("当前来源可回看，但旧证据已过期；不会直接重跑旧报告。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(OwnerExperienceStyle.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .id("researchQuestionTaskOverview")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchQuestionTaskOverview")
    }
    func researchBriefLine(title: String, value: String, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption.weight(.semibold))
            Text(value.researchInvestorWording)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }
    private func researchBriefNextAction(_ step: DailyDecisionNextStep) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("唯一下一步")
                .font(.caption.weight(.semibold))
            Text(step.title)
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            dailyNextStepButton(step)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchBriefNextAction")
    }
    private func researchBriefFreshness(_ report: TwoLayerReportData) -> String {
        let reportCutoff = String(report.payload.cutoffAt.prefix(10))
        if report.payload.evidencePackBinding?.contextVersion == limitedResearchContextVersion {
            return "有限研究 · 资料截止 \(reportCutoff) · 估值与技术条件尚未纳入"
        }
        let technicalCutoff = report.payload.evidencePackBinding?.technical.map {
            String($0.dataCutoffAt.prefix(10))
        } ?? "技术日线截止时间未提供"
        let cutoff = "报告截止 \(reportCutoff) · 技术日线截止 \(technicalCutoff)"
        if researchBriefReportIsStale(report) {
            return "上次有效 · 已过期 · \(cutoff)"
        }
        return cutoff
    }
    func researchBriefReportIsStale(_ report: TwoLayerReportData) -> Bool {
        guard !twoLayerReportWorkspace.isStaleRead, report.isCurrentExact else { return true }
        guard let value = report.payload.adviceLayer?.applicableUntil,
              let applicableUntil = parseInstant(value) else { return false }
        return applicableUntil <= Date()
    }
    private func researchBriefValidityText(report: TwoLayerReportData, advice: TwoLayerAdvice) -> String {
        let prefix = researchBriefReportIsStale(report) ? "已过适用期 · " : ""
        return "\(prefix)至 \(advice.applicableUntil.prefix(10)) · \(advice.horizonStatement)"
    }
    func researchBriefDrivers(
        report: TwoLayerReportData,
        research: TwoLayerResearch
    ) -> [String] {
        let configured = report.payload.keyDrivers.compactMap { researchBriefNonEmpty($0) }
            .filter { !($0.contains("analysis") && $0.contains("null")) }
            .map(\.researchInvestorWording)
        if !configured.isEmpty { return Array(configured.prefix(3)) }
        let facts = research.fundamentals
            + (research.context ?? [])
            + research.eventsAndCatalysts
            + (research.operatingMonitor ?? [])
        return Array(facts.filter { $0.sourceKind != "source_missing" }.map(\.statement).prefix(3))
    }
    func researchBriefPrice(_ advice: TwoLayerAdvice, includeCurrentScenarioRange: Bool = true) -> String {
        let scenarioRange = includeCurrentScenarioRange ? researchBriefScenarioValueRange() : nil
        if let range = researchBriefNonEmpty(advice.priceRange), range != "UNKNOWN" {
            if let scenarioRange {
                return "估值 / 价格区间：\(range)\n当前用户估值情景范围：\(scenarioRange)；不是目标价。"
            }
            return "估值 / 价格区间：\(range)"
        }
        if let condition = advice.priceConditions?.compactMap({ researchBriefNonEmpty($0) }).first {
            if let scenarioRange {
                return "价格条件：\(condition)\n当前用户估值情景范围：\(scenarioRange)；不是目标价。"
            }
            return "价格条件：\(condition)"
        }
        return scenarioRange.map { "当前用户估值情景范围：\($0)；不是目标价。" }
            ?? "目前未确认：当前报告没有可用估值区间或价格条件。"
    }

    private var researchBriefPriceWithoutReport: String {
        researchBriefScenarioValueRange().map { "当前用户估值情景范围：\($0)；不是目标价。" }
            ?? "目前未确认：当前没有可用估值区间或价格条件；先读取最新事实，再补齐估值情景。"
    }

    private func researchBriefScenarioValueRange() -> String? {
        guard let membership = selectedMembership,
              let envelope = researchValuationScenarioWorkspace.envelope,
              envelope.status == "available",
              envelope.requestedActorId == membership.actorId,
              envelope.membershipId == membership.id,
              envelope.membershipVersion == membership.version,
              envelope.membershipState == membership.state.rawValue,
              envelope.symbol == membership.symbol,
              let scenario = envelope.scenarioSets
                .filter({ $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty })
                .max(by: { $0.createdAt < $1.createdAt }),
              let range = scenario.calculation.valueRange,
              range.low.isFinite,
              range.high.isFinite,
              range.low > 0,
              range.low <= range.high else {
            return nil
        }
        let currency = scenario.assumptions.values.metricCurrency ?? "币种未记录"
        return "\(String(format: "%.2f", range.low))–\(String(format: "%.2f", range.high)) \(currency) · 情景读取 \(envelope.generatedAt.prefix(10))"
    }
    func researchBriefScenarioConditions(_ advice: TwoLayerAdvice) -> String {
        let scenarios = advice.scenarios?.compactMap { researchBriefNonEmpty($0) } ?? []
        return scenarios.isEmpty ? "尚未形成可核验的经营或价格情景。" : scenarios.joined(separator: "\n")
    }
    func researchBriefAffectedVariables(report: TwoLayerReportData) -> [String] {
        guard let pack = twoLayerReportWorkspace.envelope?.data?.evidencePacks.first(where: {
            $0.id == report.evidencePackId
                && $0.membershipId == selectedMembership?.id
                && $0.membershipVersion == selectedMembership?.version
                && $0.symbol == selectedMembership?.symbol
        }) else { return [] }
        return pack.items.reduce(into: [String]()) { variables, item in
            guard let variable = researchBriefNonEmpty(item.variableName),
                  !variables.contains(variable), variables.count < 3 else { return }
            variables.append(variable)
        }
    }
    func researchBriefVariableLabel(_ variable: String) -> String {
        switch variable {
        case "overseas_manufacturing_capacity": "海外制造产能"
        case "nev_sales_mix": "新能源车型销量结构"
        case "overseas_localized_production": "海外本地化生产"
        default: variable.replacingOccurrences(of: "_", with: " ")
        }
    }
    func researchBriefNextObservation(
        advice: TwoLayerAdvice,
        research: TwoLayerResearch
    ) -> String {
        researchBriefNonEmpty(advice.nextQuestion)
            ?? research.nextValidationQuestions.compactMap { researchBriefNonEmpty($0) }.first
            ?? "目前未确认：当前报告还没有明确下一观察问题，请先完成唯一下一步。"
    }
    private func researchBriefOwnerDisplayable(_ value: String?) -> String? {
        guard let value = researchBriefNonEmpty(value) else { return nil }
        let normalized = value.lowercased()
        let hiddenTerms = [
            "source_missing", "unknown", "unavailable", "not available", "missing",
            "evidence pack", "membership", "fingerprint", "binding", "reservation",
            "contextid", "snapshot", "data cutoff", "exact-current", "result hash",
            "pack/task/report identity", "result_hash", "evidence_pack", "report hash",
            "hash", "identity", "pack", "quant-research", "backend"
        ]
        return hiddenTerms.contains(where: normalized.contains) ? nil : value
    }

    private func researchBriefOwnerHasInternalTerm(_ value: String?) -> Bool {
        guard let value = researchBriefNonEmpty(value) else { return false }
        let normalized = value.lowercased()
        let internalTerms = [
            "evidence pack", "membership", "fingerprint", "binding", "reservation",
            "contextid", "snapshot", "data cutoff", "exact-current", "result hash",
            "pack/task/report identity", "result_hash", "evidence_pack", "report hash",
            "hash", "identity", "pack", "quant-research", "backend"
        ]
        return internalTerms.contains(where: normalized.contains)
    }

    func researchBriefRisk(advice: TwoLayerAdvice, research: TwoLayerResearch) -> String {
        // 该报告的风险事实来自所选研究问题，属于本问题的直接结论，优先展示；
        // 建议层长短期风险仅在研究报告未给出可展示风险时作为兜底。
        let risks = research.risks
            .filter { $0.sourceKind != "source_missing" }
            .map(\.statement)
            + advice.mediumShortTerm.risks
            + advice.longTerm.risks
        return risks.compactMap(researchBriefOwnerDisplayable).first
            ?? "目前未确认：当前没有可核验的主要风险。"
    }
    /// 报告自身保存的可读版本变化；不可展示或缺失时返回 nil，由调用方回退到字段比较。
    func researchBriefRecordedChange(_ report: TwoLayerReportData) -> String? {
        researchBriefOwnerDisplayable(report.payload.adviceLayer?.versionChange)
            ?? researchBriefOwnerDisplayable(report.payload.changeFromPrevious)
    }
    func researchBriefCounterevidence(_ research: TwoLayerResearch) -> String {
        research.counterevidence
            .filter { $0.sourceKind != "source_missing" }
            .compactMap { researchBriefOwnerDisplayable($0.statement) }
            .first ?? "目前未确认：当前没有可核验的反证。"
    }
    func researchBriefInvalidation(
        report: TwoLayerReportData,
        advice: TwoLayerAdvice
    ) -> String {
        let conditions = advice.mediumShortTerm.invalidationConditions
            + advice.longTerm.invalidationConditions
            + report.payload.invalidationConditions
        let candidates = conditions.compactMap { researchBriefNonEmpty($0) }
        guard let condition = candidates.first(where: { researchBriefOwnerDisplayable($0) != nil }) else {
            if candidates.contains(where: researchBriefOwnerHasInternalTerm) {
                return "关键材料、估值或技术依据发生变化，或主要经营风险恶化时，当前判断失效，需要重新研究。"
            }
            return "目前未确认：当前没有可核验的推翻条件。"
        }
        return condition
    }
    func researchBriefChange(report: TwoLayerReportData) -> String? {
        let reports = selectedMembershipResearchReports
        guard let change = researchBriefRecordedChange(report)
            ?? report
                .revisionSummary(previous: reports.previousReport(before: report))
                .ownerBriefChange(nextObservation: report.payload.researchLayer?.nextValidationQuestions.first) else { return nil }
        let decision = twoLayerReportWorkspace.envelope?.data?.decisions.first { $0.reportId == report.id }
        if researchBriefReportIsStale(report) {
            return "上次有效版本相对更早版本：\(change) 当前没有待确认的新判断。"
        }
        if decision?.decision == "confirmed" { return "\(change) 这版已由你确认。" }
        if decision?.decision == "rejected" { return "\(change) 这版已由你驳回，等待修订。" }
        if report.status == "evidence_insufficient" { return "\(change) 证据仍不足，不能确认正式判断。" }
        return "\(change) 新版本仍需你明确确认，确认前不会成为正式判断。"
    }
    func researchBriefNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    private func researchBriefFacts(_ research: TwoLayerResearch) -> [TwoLayerReportFact] {
        research.fundamentals
            + (research.context ?? [])
            + research.valuation
            + research.technical
            + (research.quantPortfolio ?? [])
            + research.eventsAndCatalysts
            + (research.operatingMonitor ?? [])
            + research.risks
            + research.counterevidence
    }
    @ViewBuilder
    func researchBriefSource(
        report: TwoLayerReportData,
        research: TwoLayerResearch
    ) -> some View {
        let facts = researchBriefFacts(research)
        let membership = selectedMembership
        let binding = report.payload.evidencePackBinding
        let pack = twoLayerReportWorkspace.envelope?.data?.evidencePacks.first {
            $0.id == report.evidencePackId
                && $0.membershipId == membership?.id
                && $0.membershipVersion == membership?.version
                && $0.symbol == membership?.symbol
                && binding?.membershipId == $0.membershipId
                && binding?.membershipVersion == $0.membershipVersion
                && binding?.symbol == $0.symbol
                && binding?.fingerprint == $0.packFingerprint
        }
        if let pack,
           let fact = facts.first(where: { !pack.reopenableMaterials(for: $0).isEmpty }),
           let material = pack.reopenableMaterials(for: fact).first {
            VStack(alignment: .leading, spacing: 4) {
                Text("引用来源")
                    .font(.caption.weight(.semibold))
                Text(material.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    Task {
                        await openTwoLayerMaterialCitation(
                            report: report,
                            pack: pack,
                            material: material
                        )
                    }
                } label: {
                    Label("打开引用来源", systemImage: "doc.text.magnifyingglass")
                }
                .buttonStyle(.bordered)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchBriefSource")
        } else if let citation = facts.compactMap({ $0.citation?.reopenableDocumentCitation }).first {
            Button {
                Task { await openResearchContextCitation(citation) }
            } label: {
                Label("打开引用来源 · PDF 第 \(citation.pageNumber) 页", systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchBriefSource")
        } else if report.isCurrentExact,
                  let pack,
                  let fact = facts.first(where: {
                      pack.exactExternalSourceURL(
                        for: $0,
                        events: twoLayerReportWorkspace.envelope?.data?.events ?? []
                      ) != nil
                  }) {
            Button {
                Task { await openTwoLayerExternalSource(report: report, fact: fact) }
            } label: {
                Label("打开引用来源", systemImage: "safari")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchBriefSource")
        } else {
            Text("当前没有可重开的正式来源，请先完成下一步核验。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchBriefSource")
        }
    }
    private func dailyNextStepCopy(_ step: DailyDecisionNextStep) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(step.title)
                .font(.callout.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("dailyDecisionNextStepTitle")
            Text(step.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("dailyDecisionNextStepDetail")
        }
    }
    private func dailyNextStepButton(_ step: DailyDecisionNextStep) -> some View {
        Button {
            showDailyDecisionLayer(step.layer, expandResult: step.expandsResult)
            if let workspace = step.evidenceWorkspace { selectedEvidenceWorkspace = workspace }
            if let target = step.scrollTarget {
                if target == "researchAnnouncementEvents" { isResearchEventCaptureExpanded = true }; pendingDecisionWorkspaceScrollTarget = target
            }
        } label: {
            Label(step.buttonTitle, systemImage: "arrow.right")
                .font(.callout.weight(.semibold))
        }
        .buttonStyle(.borderedProminent)
        // Platform blue restores white-on-blue contrast for this native prominent button.
        .tint(.blue)
        .accessibilityLabel("\(step.buttonTitle)，前往\(step.layer.title)")
        .accessibilityIdentifier("dailyDecisionNextStepButton")
    }
    private func dailyRingStatusLabel(_ state: String) -> String {
        switch state {
        case "available": "已读取"
        case "unavailable": "受限"
        case "loading": "读取中"
        case "stale": "已陈旧"
        case "partial": "不完整"
        default: state
        }
    }
}

extension String {
    func researchBriefOwnerCondition(replacement: String) -> String {
        let internalTerms = [
            "snapshot", "result", "data cutoff", "exact-current", "evidence pack",
            "membership", "fingerprint", "binding", "reservation", "contextid",
            "source_missing", "unknown", "unavailable", "not available", "missing",
            "result_hash", "evidence_pack", "report hash", "hash", "identity", "pack",
            "quant-research", "backend"
        ]
        return internalTerms.contains(where: { lowercased().contains($0) }) ? replacement : self
    }
}
