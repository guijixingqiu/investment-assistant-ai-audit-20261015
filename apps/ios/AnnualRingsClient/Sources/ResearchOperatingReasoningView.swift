import SwiftUI

struct ResearchOperatingReasoningEntry: View {
    let reasoning: ResearchOperatingReasoning
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var review: ResearchReviewProjectionClient?
    private var reviewSummary: String {
        guard let review else { return "持续复核状态正在读取" }
        if review.status == "ENDED" { return "原判断已结束" }
        if !review.enabled { return "持续复核尚未启用" }
        switch review.status {
        case "REVIEW_REQUIRED": return "需要重新审视 · \(review.activeMilestone?.description ?? "验证节点")"
        case "REVIEW_DUE": return "验证节点已到 · \(review.activeMilestone?.description ?? "预期证据仍不完整")"
        default: return "当前无需重新审视 · 下一验证：\(review.activeMilestone?.description ?? "待设定")"
        }
    }
    var body: some View {
        NavigationLink { ResearchOperatingReasoningView(initial: reasoning) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack { Label("本次研究变化", systemImage: "point.3.connected.trianglepath.dotted").font(.system(size: 14, weight: .semibold)); Spacer(); Image(systemName: "chevron.right").font(.caption) }
                Text("当前研究判断：" + (reasoning.model.thesisRevision?.status == "OWNER_CONFIRMED" ? reasoning.model.thesisRevision!.newThesis : api.currentCandidate.currentDossier.judgmentTitle)).foregroundStyle(Theme.textPrimary).lineLimit(2)
                Text(reasoning.thesisImpact == nil ? "尚未选择要检验的原假设" : (reasoning.thesisUpdate?.overallEvidence?.status == "OWNER_REVIEW_REQUIRED" ? "Test 结果可用 · 原判断需要 Owner 复核" : "草稿评估：\(reasoning.thesisImpact.map { operatingAssessmentTitle($0.assessment) } ?? "证据不足")")).foregroundStyle(Theme.gold)
                Text(reasoning.researchUpdate?.summary ?? reasoning.fact.text).foregroundStyle(Theme.blue).lineLimit(2)
                HStack { Text("传导：\(reasoning.profitTransmission.stoppedAt.map(operatingMetricTitle) ?? "因果待核查") 待核查"); Spacer(); Text("估值：\(reasoning.scenarios.allSatisfy { $0.status == "complete" } ? "情景已计算" : "假设待补充")") }.font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Text("最大 UNKNOWN：\(reasoning.unknown.text)").foregroundStyle(Theme.textSecondary).lineLimit(2)
                Text(reviewSummary).foregroundStyle(Theme.blue).lineLimit(2).accessibilityIdentifier("phase12ResearchSummary")
                Text("下一步 · \(reasoning.nextResearchQuestion)").foregroundStyle(Theme.gold).lineLimit(2)
            }.font(.system(size: 12)).foregroundStyle(Theme.textPrimary).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityIdentifier("researchOperatingReasoningEntry")
            .task(id: reasoning.inputFingerprint) { review = try? await api.researchReview(reasoning) }
    }
}

/// The public comparison is a reading aid. The ordinary decision remains an
/// editable Owner action in the existing manual research workflow.
struct OperatingChangeToJudgmentView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var investigation: PersonalInvestigationSelection?
    let reasoning: ResearchOperatingReasoning
    let historicalReference: Bool

    init(reasoning: ResearchOperatingReasoning, historicalReference: Bool = false) {
        self.reasoning = reasoning
        self.historicalReference = historicalReference
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("经营资料变化与我的判断").font(.headline)
            if historicalReference {
                Text("历史资料参考 · 来源当前有效性待重新核对；不能把当时解释当作今天的经营事实。")
                    .font(.caption).foregroundStyle(Theme.gold)
            }
            if let label = reasoning.publicResearchChangeLabel {
                Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.blue)
                if let fact = reasoning.publicResearchChangeFact {
                    disclosureRow("本次变化涉及的事实", fact: fact)
                    Text(publicationRelation(for: fact)).font(.caption).foregroundStyle(Theme.gold)
                } else {
                    Text("本次更新未定位到可核对的经营事实原件；请从资料页核对来源，不能把更新摘要套到其他指标。")
                        .font(.caption).foregroundStyle(Theme.gold)
                }
            }
            if let comparison = relevantComparison {
                Text("不同披露日期 · 同口径期间比较").font(.caption).foregroundStyle(Theme.blue)
                disclosureRow("较早披露", fact: comparison.earlier)
                disclosureRow("较新披露", fact: comparison.later)
                Text("同口径变化：" + comparisonChange(comparison))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.blue)
            } else {
                Text(unavailableReason).font(.caption).foregroundStyle(Theme.gold)
            }
            if reasoning.researchUpdate?.change?.triggerType == "verification_upgrade" {
                Text("数值和口径未改变；本次核对升级不构成新的经营或利润传导。")
                    .foregroundStyle(Theme.gold)
            } else if explanationMatchesDisplayedFact {
                Text((historicalReference ? "当时的经营解释：" : "经营含义（解释候选）：") + reasoning.operatingMeaning.text)
                if !historicalReference { Text("利润传导：" + reasoning.profitTransmission.text) }
            } else {
                Text("当前经营解释草稿依据另一指标；对这次资料变化的利润影响仍待核查。")
                    .foregroundStyle(Theme.gold)
            }
            ordinaryJudgmentContext
            Text("仍然未知：" + reasoning.unknown.text).foregroundStyle(Theme.gold)
            Text("下一问题：" + reasoning.nextResearchQuestion).foregroundStyle(Theme.blue)
            Button(hasPreviousOrdinaryJudgment ? "核对来源并修订我的判断" : "从资料记录我的判断") {
                let comparison = relevantComparison
                let sourceFacts = ([reasoning.publicResearchChangeFact] +
                                   [comparison?.earlier, comparison?.later]).compactMap { $0 }
                let uniqueSourceFacts = sourceFacts.reduce(into: [OperatingFact]()) { selected, fact in
                    if !selected.contains(where: { $0.id == fact.id }) { selected.append(fact) }
                }
                investigation = PersonalInvestigationSelection(
                    membershipId: reasoning.membershipId, membershipVersion: reasoning.membershipVersion,
                    symbol: reasoning.symbol, mode: "earnings_quality",
                    question: reasoning.nextResearchQuestion, startAnalysis: false, resumeExisting: false,
                    ordinaryChangeContext: uniqueSourceFacts.isEmpty ? nil :
                        PersonalOrdinaryChangeContext(reasoningFingerprint: reasoning.inputFingerprint,
                            comparison: comparison,
                            sourceFacts: uniqueSourceFacts,
                            selectedFactId: reasoning.publicResearchChangeFact?.id ?? comparison?.later.id,
                            changeTriggerType: reasoning.researchUpdate?.change?.triggerType,
                            changeId: reasoning.publicResearchChangeFact == nil ? nil : reasoning.researchUpdate?.change?.id,
                            previousOrdinaryCheckId: previousOrdinaryCheck?.id,
                            operatingMeaning: explanationMatchesDisplayedFact ? reasoning.operatingMeaning.text : "",
                            unknown: reasoning.unknown.text,
                            nextQuestion: reasoning.nextResearchQuestion)
                    )
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("operatingChangeToManualJudgment")
            Text("变化和解释仅供核对。选定原件、证据摘要、判断正文及复盘日期均由你确认后才保存；这里不会发送 AI 或写入决定。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
        }
        .sheet(item: $investigation, onDismiss: { api.finishPersonalFormalDismissal() }) {
            PersonalInvestigationView(selection: $0)
        }
    }

    @ViewBuilder private func disclosureRow(_ title: String, fact: OperatingFact) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title + " · 公开日期 " + String(fact.source.publishedAt.prefix(10))).font(.subheadline.weight(.semibold))
            Text(fact.text)
            Text("期间截至 " + fact.period.end + " · " + fact.businessScope + " · " + fact.accountingScope)
                .font(.caption).foregroundStyle(Theme.textSecondary)
            NavigationLink("查看原件与口径 · 材料 #" + fact.source.materialId) { OperatingFactDetail(fact: fact) }
        }
        .padding(10).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private var ordinaryJudgmentContext: some View {
        switch api.manualJudgmentProjection(symbol: reasoning.symbol) {
        case .some(.recorded(let record)):
            Text("原普通判断 · " + WorkspaceTimestamp.hongKong(record.checkedAt)).font(.subheadline.weight(.semibold))
            Text(verbatim: record.originalText)
            Text("上述变化是否支持、削弱或不影响原判断，仍须由你在下一页明确填写。")
                .font(.caption).foregroundStyle(Theme.gold)
        case .some(.stale), .some(.unavailable), nil:
            Text("旧普通判断暂不能可靠回读；进入后请先核对决定历史。")
                .font(.caption).foregroundStyle(Theme.gold)
        default:
            Text("尚无可对照的普通判断；可以从资料开始记录。")
                .font(.caption).foregroundStyle(Theme.textSecondary)
        }
    }

    private var unavailableReason: String {
        switch reasoning.researchUpdate?.change?.triggerType {
        case "old_evidence_extracted": return "这是旧资料补充整理；缺少同口径前期值时不计算增速，也不能称为旧判断后的新披露。"
        case "verification_upgrade": return "这次只升级来源核验，数值未变；不据此计算新的经营增速。"
        case "evidence_correction", "evidence_invalidation": return "原结构化事实已被修订或撤回；先核对更正原件，不能沿用旧数值比较。"
        case "new_disclosure": return "已记录新的公开资料，但尚无可核对的同口径前期事实；不计算数值变化。"
        default: return "当前没有两条披露日期、期间和口径均可核对的事实；不计算数值变化。仍可核对其他经营资料并记录判断。"
        }
    }

    private var relevantComparison: OperatingDisclosureComparison? {
        if reasoning.researchUpdate?.change?.triggerType == "verification_upgrade" { return nil }
        guard let comparison = reasoning.publicDisclosureComparison else { return nil }
        if reasoning.publicResearchChangeLabel != nil {
            return reasoning.publicResearchChangeFact?.id == comparison.later.id ? comparison : nil
        }
        return comparison
    }

    private var explanationMatchesDisplayedFact: Bool {
        if let changed = reasoning.publicResearchChangeFact { return changed.id == reasoning.fact.id }
        return relevantComparison?.later.id == reasoning.fact.id
    }

    private func publicationRelation(for fact: OperatingFact) -> String {
        guard let previous = previousOrdinaryCheck else { return "当前没有可回读的旧普通判断日期；此资料只作为参考。" }
        let published = String(fact.source.publishedAt.prefix(10))
        let checked = String(previous.checkedAt.prefix(10))
        if published < checked { return "资料公开于旧判断（\(checked)）之前；这是旧资料参考，不是旧判断后的新披露。" }
        if published > checked { return "资料公开于旧判断（\(checked)）之后；请评估是否需要修订。" }
        return "资料与旧判断同日（\(checked)）；先核对具体时点，再决定是否修订。"
    }

    private var hasPreviousOrdinaryJudgment: Bool {
        previousOrdinaryCheck != nil
    }

    private var previousOrdinaryCheck: RecordedDecisionCheckReviewState? {
        guard let member = api.membershipEnvelope?.memberships.first(where: {
            $0.id == reasoning.membershipId && $0.version == reasoning.membershipVersion
                && $0.symbol == reasoning.symbol && $0.state.rawValue == "tracked"
        }) else { return nil }
        return api.decisionHistory(symbol: reasoning.symbol, member: member)?
            .last(where: { api.isOrdinaryDecisionRecord($0) })
    }

    private func comparisonChange(_ comparison: OperatingDisclosureComparison) -> String {
        if comparison.later.unit == "ratio" {
            return String(format: "%+.2f 个百分点", comparison.change * 100)
        }
        let value = operatingValue(comparison.change, unit: comparison.later.unit,
                                   currency: comparison.later.currency)
        let ratio = comparison.changeRatio.map { String(format: "（%+.2f%%）", $0 * 100) } ?? ""
        return (comparison.change > 0 ? "+" : "") + value + ratio
    }
}

struct ResearchOperatingReasoningView: View {
    let initial: ResearchOperatingReasoning
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var step = 0
    private let titles = ["事实和来源", "经营解释", "盈利传导", "假设影响", "仍然未知", "下一问题"]
    var body: some View {
        OperatingBoundPage(initial: initial, title: "本次研究变化") { value in
            Text("\(value.symbol) · 研究草稿 · \(step + 1) / 6").font(.caption).foregroundStyle(Theme.textSecondary)
            ProgressView(value: Double(step + 1), total: 6).tint(Theme.blue)
            Text(titles[step]).font(.system(size: 18, weight: .semibold)).accessibilityIdentifier("operatingReasoningStep-\(step)")
            stage(value)
        }.safeAreaInset(edge: .bottom) {
            HStack { if step > 0 { Button("上一步") { step -= 1 } }; Spacer(); if step < 5 { Button("下一步：\(titles[step + 1])") { step += 1 }.accessibilityIdentifier("operatingReasoningNext") } }.font(.system(size: 13, weight: .medium)).tint(Theme.blue).padding(16).background(Theme.bgPrimary)
        }
    }
    @ViewBuilder private func stage(_ value: ResearchOperatingReasoning) -> some View {
        switch step {
        case 0:
            OperatingChangeToJudgmentView(reasoning: value)
            Text("FACT · 发行人披露转录（核验状态见来源）").foregroundStyle(Theme.blue)
            Text(value.fact.text)
            if let growth = value.facts.first(where: { $0.id == value.growthFactId }) { Text("发行人披露同比：\(operatingValue(growth.value, unit: "ratio"))").foregroundStyle(Theme.blue) }
            Text(value.fact.limitation).foregroundStyle(Theme.textSecondary)
            NavigationLink("来源、口径与版本") { OperatingFactDetail(fact: value.fact) }.accessibilityIdentifier("operatingReasoningSource")
            NavigationLink("研究问题与证据进展") { OperatingResearchQuestionsView(initial: value) }.accessibilityIdentifier("phase6Questions")
            NavigationLink("Fact Candidates · 待核对提取") { OperatingFactCandidatesView(initial: value) }.accessibilityIdentifier("phase5Candidates")
            NavigationLink("管理层指引与实际") { OperatingGuidanceView(initial: value) }
            NavigationLink("本期销量结构") { OperatingProductMixView(initial: value) }.accessibilityIdentifier("operatingProductMixEntry")
        case 1:
            Text("INTERPRETATION · 解释候选").foregroundStyle(Theme.gold)
            Text(value.operatingMeaning.text)
        case 2:
            Text("HYPOTHESIS · 条件传导").foregroundStyle(Theme.gold)
            ForEach(Array(value.profitTransmission.steps.enumerated()), id: \.offset) { _, node in
                NavigationLink { OperatingNodeDetail(node: node, symbol: value.symbol) } label: {
                    HStack { Text(operatingMetricTitle(node.metric)); Spacer(); Text(node.semanticType).font(.system(size: 10)).foregroundStyle(node.semanticType == "UNKNOWN" ? Theme.gold : Theme.blue) }.padding(11).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain)
            }
            Text("停止于 \(value.profitTransmission.stoppedAt.map(operatingMetricTitle) ?? "因果核查")").foregroundStyle(Theme.gold).accessibilityIdentifier("operatingReasoningUnknownStop")
            Text(value.profitTransmission.text)
            NavigationLink("单独查看半年报利润桥") { OperatingProfitBridgeView(initial: value) }
        case 3:
            if let impact = value.thesisImpact {
                Text(value.thesisUpdate?.overallEvidence?.status == "OWNER_REVIEW_REQUIRED" ? "整体原判断：待 Owner 复核" : "对原假设：\(operatingAssessmentTitle(impact.assessment))").foregroundStyle(Theme.gold)
                Text("报告 v\(impact.reportVersion) · 假设 \(impact.conditionIndex + 1)").font(.caption)
                Text(impact.hypothesis); Text(impact.explanation)
            } else { Text("UNKNOWN · 尚未显式选择已有研究假设").foregroundStyle(Theme.gold) }
            NavigationLink("Thesis Update Draft") { OperatingThesisUpdateView(initial: value) }.accessibilityIdentifier("operatingThesisUpdateEntry")
            NavigationLink("盈利预期 / 预期差 / 重新审视判断") { ResearchUnderwritingView(initial: value) }.accessibilityIdentifier("phase11UnderwritingEntry")
            NavigationLink("持续验证与正式复核") { ResearchReviewView(initial: value) }.accessibilityIdentifier("phase12ReviewEntry")
            NavigationLink("选择假设 / 编辑研究草稿") { OperatingModelEditor(initial: value) }
            Text("保存仅创建研究上下文的新版本；原报告和正式决定保持原记录。历史版本的时效以报告历史为准。").font(.caption).foregroundStyle(Theme.textSecondary)
        case 4:
            Text("UNKNOWN · 证据边界").foregroundStyle(Theme.gold); Text(value.unknown.text)
            ForEach(value.gaps ?? [], id: \.metric) { gap in Text(operatingMetricTitle(gap.metric) + " · " + gap.reason).font(.caption).foregroundStyle(Theme.textSecondary) }
            Text("周保险注册量只用于异常发现和复核；不同期间、批发与零售口径不能相加或替代。").font(.caption).foregroundStyle(Theme.textSecondary)
        default:
            Text(value.nextResearchQuestion).foregroundStyle(Theme.blue)
            Text(value.questions.first?.reason ?? "").font(.caption)
            Text(value.gaps?.first?.reason == "NOT_EXTRACTED" ? "可能可从已有材料提取：进入 Fact Candidates 核对" : "当前缺口仍需匹配期间和口径的来源").font(.caption).foregroundStyle(Theme.textSecondary)
            DisclosureGroup("其他候选问题与排序依据") {
                ForEach(Array(value.questions.dropFirst().enumerated()), id: \.offset) { _, question in VStack(alignment: .leading, spacing: 6) { Text(question.question); Text(question.reason).font(.caption).foregroundStyle(Theme.textSecondary) }.padding(.vertical, 6) }
            }
        }
    }
}

struct OperatingBoundPage<Content: View>: View {
    let initial: ResearchOperatingReasoning; let title: String; @ViewBuilder let content: (ResearchOperatingReasoning) -> Content
    @ObservedObject private var api = OwnerClientStore.shared
    var body: some View {
        ScrollView {
            if let current = api.boundOperatingReasoning(symbol: initial.symbol), current.inputFingerprint == initial.inputFingerprint {
                VStack(alignment: .leading, spacing: 16) { content(current) }.font(.system(size: 14)).foregroundStyle(Theme.textPrimary).padding(18).frame(maxWidth: .infinity, alignment: .leading)
            } else { ContentUnavailableView("研究绑定已变化", systemImage: "arrow.triangle.2.circlepath", description: Text("股票、材料或研究版本已变化。返回研究首页重新打开。")) }
        }.background(Theme.bgPrimary.ignoresSafeArea()).navigationTitle(title).navigationBarTitleDisplayMode(.inline).tint(Theme.blue)
    }
}

struct OperatingFactDetail: View {
    let fact: OperatingFact
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 16) {
            Text(fact.text).font(.system(size: 17, weight: .semibold))
            Text("FACT · 来源转录").foregroundStyle(Theme.blue)
            Text("证据有效性：\(fact.evidenceValidity ?? "VALID")\n研究新鲜度：\(fact.researchRecency ?? "UNKNOWN")").accessibilityIdentifier("phase7FactDurability")
            Text(fact.limitation).foregroundStyle(Theme.gold)
            Text("业务范围：\(fact.businessScope)\n会计范围：\(fact.accountingScope)\n测量口径：\(fact.measurementBasis)\n类别：\(fact.category == "guidance" ? "管理层指引，非实际业绩" : "实际披露")\n单位：\(fact.unit) × \(fact.unitScale.formatted())\n可比性：\(fact.comparability)")
            OperatingSourceDetail(source: fact.source, symbol: fact.symbol)
        }.font(.system(size: 13)).foregroundStyle(Theme.textPrimary).padding(18) }.background(Theme.bgPrimary).navigationTitle("事实与来源").navigationBarTitleDisplayMode(.inline)
    }
}
struct OperatingSourceDetail: View {
    let source: OperatingSource
    let symbol: String
    @ObservedObject private var store = OwnerClientStore.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let citation = source.snapshotCitation,
               let original = source.snapshotOriginal,
               let member = store.membershipEnvelope?.memberships.first(where: { $0.symbol == symbol && $0.state.rawValue == "tracked" }) {
                NavigationLink("打开已保存官方网页原文") {
                    CompanyStoredSourceReader(membership: member, snapshotId: citation.snapshotId,
                        expectedCitation: citation, expectedOriginal: original)
                }
            }
            if let captured = source.capturedSourceUrl, let url = URL(string: captured) {
                Link("发布方现场链接（非已存原件）", destination: url).foregroundStyle(Theme.blue)
            }
            Text("文档捕获来源：" + (source.capturedSourceUrl ?? "来源网址未记录"))
            if let supplemental = source.ownerSuppliedReferenceUrl { Text("Owner 补充参考 URL：" + supplemental).textSelection(.enabled) }
            Text("来源分类：\(source.sourceClassification)\n材料核验：\(source.verificationStatus)\n本条数值核对：\(source.assertionVerificationStatus)\n披露：\(source.publishedAt.prefix(10))\n资料截止：\(source.cutoffAt.prefix(10))\n材料复核提醒：\(source.validUntil.hasPrefix("2100-01-01") ? "未设置定期提醒" : String(source.validUntil.prefix(10)))（不影响历史事实有效性）")
            Text("数字：" + (source.verification?.valueVerification ?? source.assertionVerificationStatus))
            Text("结构标签：" + (source.verification?.structureVerification ?? "legacy · 未记录结构核验"))
            if let confirmation = source.verification?.ownerConfirmation { Text("Owner 明确确认字段：" + confirmation.confirmedFields.joined(separator: "、")); Text(confirmation.confirmedBy + " · " + confirmation.confirmedAt).font(.caption) }
            if let verification = source.verification { ForEach(verification.checks.keys.sorted(), id: \.self) { key in Text(key + "：" + (verification.checks[key] == true ? "source labels verified" : "未由原文规则证明")) }; Text("范围映射确认者：" + (verification.taxonomyConfirmedBy ?? "未记录")) }
            if let binding = source.structureBinding { Text("行：" + binding.rowLabelText); Text("列：" + binding.columnHeaderText); Text("单位：" + binding.unitHeaderText) }
            Text("Provenance：" + (source.provenanceKind ?? "legacy provenance · 保留历史来源标签"))
            if let binding = source.textBinding { Text("原文：" + binding.sourceExcerpt).textSelection(.enabled); Text("原始数字：" + binding.rawValueText) }
            if let binding = source.snapshotTextBinding { Text("已存选段：" + binding.sourceExcerpt).textSelection(.enabled); Text("原始数字：" + binding.rawValueText) }
            if source.assertionVerificationStatus == "verified" { Text("历史手工核对记录，未自动升级为 source_text_verified。") }
            DisclosureGroup("引用和修订记录") {
                if let citation = source.snapshotCitation, let original = source.snapshotOriginal {
                    Text("材料 \(source.materialId) / r\(source.revision)\n网页快照 \(citation.snapshotId)\n原件 SHA256 \(original.rawSha256)\n选段 SHA256 \(citation.excerptSha256)")
                        .font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                } else {
                    Text("材料 \(source.materialId) / r\(source.revision)\nPDF \(source.documentId ?? "未知") / p\(source.pageNumber.map(String.init) ?? "未知")\nPDF SHA256 \(source.documentPdfSha256 ?? "未知")\n页 SHA256 \(source.pageTextSha256 ?? "未知")")
                        .font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                }
            }
        }.font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
    }
}
struct OperatingNodeDetail: View {
    let node: OperatingNode
    let symbol: String
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 16) {
            Text(operatingValue(node.value, unit: node.unit, currency: node.currency)).font(.system(size: 22, weight: .semibold))
            Text("\(node.semanticType) · \(node.derivationMethod)").foregroundStyle(Theme.gold)
            Text("\(node.period.start ?? node.period.end) 至 \(node.period.end)")
            Text("范围：\(node.businessScope) · \(node.accountingScope)\n测量口径：\(node.measurementBasis)").font(.caption).foregroundStyle(Theme.textSecondary)
            Text(node.limitation)
            if let formula = node.calculation { Text(formula).font(.system(size: 12, design: .monospaced)); Text("输入事实：\(node.inputs.joined(separator: ", "))").font(.caption) }
            ForEach(Array(node.source.enumerated()), id: \.offset) { _, source in OperatingSourceDetail(source: source, symbol: symbol) }
        }.font(.system(size: 14)).foregroundStyle(Theme.textPrimary).padding(18) }.background(Theme.bgPrimary).navigationTitle(operatingMetricTitle(node.metric)).navigationBarTitleDisplayMode(.inline)
    }
}

struct OperatingProfitBridgeView: View {
    let initial: ResearchOperatingReasoning
    var body: some View {
        OperatingBoundPage(initial: initial, title: "盈利与现金流") { value in
            NavigationLink("历史序列") { OperatingEvidenceSeriesView(initial:value) }.accessibilityIdentifier("phase7HistorySeries")
            if let bridge = value.profitBridge {
                Text("\(bridge.period.end) / 同期可比利润桥").font(.system(size: 18, weight: .semibold)).accessibilityIdentifier("operatingProfitBridgeTitle")
                Text("期间：\(bridge.period.start ?? "") 至 \(bridge.period.end)\n对比：\(bridge.previousPeriod.start ?? "") 至 \(bridge.previousPeriod.end)").font(.caption).foregroundStyle(Theme.textSecondary)
                Text("发行人未经审计披露；上年比较数须使用同份报表的重述口径。计算结果标为 INTERPRETATION。").font(.caption).foregroundStyle(Theme.gold)
                ForEach(Array(bridge.rows.enumerated()), id: \.offset) { _, row in
                    NavigationLink { VStack { OperatingNodeDetail(node: row.current, symbol: value.symbol) } } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack { Text(operatingMetricTitle(row.metric)).fontWeight(.medium); Spacer(); Text(row.current.semanticType).font(.system(size: 9)).foregroundStyle(Theme.gold) }
                            HStack { Text(operatingValue(row.current.value, unit: row.current.unit, currency: row.current.currency)).foregroundStyle(Theme.blue); Spacer(); Text(row.current.unit == "ratio" ? (row.change.map { String(format: "%+.2f 个百分点", $0 * 100) } ?? "不可比") : (row.changeRatio.map { String(format: "%+.2f%%", $0 * 100) } ?? "百分比不可比")).foregroundStyle(Theme.textSecondary) }
                            Text("上年：\(operatingValue(row.previous.value, unit: row.previous.unit, currency: row.previous.currency))").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }.font(.system(size: 13)).padding(12).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain)
                }
                Text("现金流代理值不等于可直接分配给股东的现金流。").font(.caption).foregroundStyle(Theme.gold)
                Text("盈利质量核查").font(.system(size: 17, weight: .semibold))
                ForEach(Array(bridge.quality.enumerated()), id: \.offset) { _, q in
                    VStack(alignment: .leading, spacing: 6) { Text("\(q.topic) · 具体命题观察").foregroundStyle(Theme.gold); Text(q.text).font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }
                }
            } else { ContentUnavailableView("利润桥证据不足", systemImage: "doc.text.magnifyingglass", description: Text("需要同范围、可比期间的实际财务披露。")) }
        }
    }
}
private func assessmentTitle(_ value: String) -> String { ["supported":"已支持", "partially_supported":"部分支持", "weakened":"削弱", "insufficient_evidence":"证据不足"][value] ?? value }

func operatingAssessmentTitle(_ v: String) -> String { ["supports":"支持", "partially_supports":"部分支持", "weakens":"削弱", "invalidates":"失效", "insufficient_evidence":"证据不足"][v] ?? v }
struct OperatingProductMixView: View {
    let initial: ResearchOperatingReasoning
    var body: some View { OperatingBoundPage(initial: initial, title: "本期销量结构") { v in
        NavigationLink("历史序列") { OperatingEvidenceSeriesView(initial:v) }.accessibilityIdentifier("phase7MixSeries")
        Text("\(v.fact.period.end.prefix(7)) · 发行人销量 · 未经审计").font(.headline)
        ForEach(["brand", "powertrain", "geography"], id: \.self) { dimension in
            Text(["brand":"品牌", "powertrain":"动力", "geography":"地域"][dimension] ?? dimension).font(.headline)
            ForEach((v.productMix ?? []).filter { $0.dimension == dimension && $0.parentNode == nil }, id: \.factId) { mix in
                VStack(alignment: .leading, spacing: 8) {
                    mixRow(mix, v)
                    let children = (v.productMix ?? []).filter { $0.parentNode == mix.dimensionValue && $0.shareBasis == "total" && $0.dimension == dimension }
                    if !children.isEmpty { DisclosureGroup("展开 " + mix.dimensionValue + " 子分类") { ForEach(children, id: \.factId) { child in
                        mixRow(child, v)
                        if let parentShare = v.productMix?.first(where: { $0.factId == child.factId && $0.shareBasis == "parent" }) { Text("占父分类 " + mix.dimensionValue + "：" + operatingValue(parentShare.value, unit: "ratio")).font(.caption).foregroundStyle(Theme.gold) }
                    } }.accessibilityIdentifier("phase5Hierarchy-" + mix.dimensionValue) }
                }.padding(10).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        if (v.productMix ?? []).isEmpty { Text("UNKNOWN · 尚无结构化分类事实") }
        Text("ASP 与利润仍须独立证据，不能由销量结构占比直接推断。").foregroundStyle(Theme.gold)
    } }
    @ViewBuilder private func mixRow(_ mix: OperatingProductMix, _ v: ResearchOperatingReasoning) -> some View {
        Text(mix.dimensionValue + " · 占总销量 " + operatingValue(mix.value, unit: "ratio")).foregroundStyle(Theme.blue)
        Text(mix.semanticType + " · " + (mix.overlapPolicy ?? "分类关系待核对")).font(.caption)
        if let fact = v.facts.first(where: { $0.id == mix.factId }) { NavigationLink("数量及原文来源") { OperatingFactDetail(fact: fact) } }
    }
}
struct OperatingThesisUpdateView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let initial: ResearchOperatingReasoning
    var preview: ResearchOperatingReasoning? = nil
    var body: some View { OperatingBoundPage(initial: initial, title: "Thesis Update Draft") { bound in
        let v = preview ?? bound
        if preview != nil { Text("仅预览 · 未写入 Owner 当前 Context").foregroundStyle(Theme.blue).accessibilityIdentifier("phase5PreviewOnly") }
        if let d = v.thesisUpdate {
            Text(d.overallEvidence?.status == "OWNER_REVIEW_REQUIRED" ? "整体判断 · 需要 Owner 复核" : "系统证据汇总 · DRAFT · \(operatingAssessmentTitle(d.assessment))").foregroundStyle(Theme.gold)
            Text("原判断").font(.headline); Text(d.originalThesis.conditionText)
            Text("报告 \(d.originalThesis.reportId) / v\(d.originalThesis.reportVersion) · 条件 \(d.originalThesis.conditionIndex + 1)").font(.caption)
            if (d.tests ?? []).isEmpty { Text("旧版检验维度：" + (d.dimension ?? "custom_unknown")).font(.caption) }
            if let proposition = d.originalThesis.proposition { Text("已选指标：" + proposition.metrics.map(operatingMetricTitle).joined(separator: "、") + " · " + proposition.periodType).font(.caption).foregroundStyle(Theme.textSecondary) }
            ForEach([("新披露证据", d.newDisclosureEvidence ?? []), ("旧资料新结构化", d.newlyExtractedOldEvidence ?? []), ("修订 / 重列", d.corrections ?? [])], id: \.0) { title, ids in
                Text(title).font(.headline)
                if ids.isEmpty { Text("当前无此类证据").font(.caption).foregroundStyle(Theme.textSecondary) }
                ForEach(v.facts.filter { ids.contains($0.id) }) { fact in NavigationLink(fact.text) { OperatingFactDetail(fact: fact) } }
            }
            Text("支持 \((d.tests ?? []).filter { $0.result == "PASS" }.count) · 削弱 \((d.tests ?? []).filter { $0.result == "FAIL" }.count) · 待确认 \((d.tests ?? []).filter { !["PASS", "FAIL"].contains($0.result) }.count)").foregroundStyle(Theme.gold).accessibilityIdentifier("phase7TestCounts")
            ForEach(d.tests ?? []) { result in
                Text(result.test.metrics.map(operatingMetricTitle).joined(separator: "、") + " · " + result.result).font(.headline).accessibilityIdentifier("phase6Test-" + result.test.metrics.joined(separator: "-"))
                Text("Test 维度：" + result.test.dimension).font(.caption)
                Text(operatingComparisonTitle(result.test.comparison) + " · " + (result.test.referencePeriod == "previous_year" ? "上年同期间" : "前一期")).font(.caption)
                ForEach(result.observations, id: \.metric) { observation in
                    Text("观察值 " + operatingValue(observation.observed, unit: ["gross_margin", "sales_volume_yoy", "mix_share"].contains(observation.metric) ? "ratio" : "currency") + " / 比较期 " + operatingValue(observation.previous, unit: ["gross_margin", "sales_volume_yoy", "mix_share"].contains(observation.metric) ? "ratio" : "currency"))
                    if let threshold = observation.threshold { switch threshold { case .number(let n): Text("阈值 " + operatingValue(n)); case .range(let l, let u): Text("区间 " + operatingValue(l) + "–" + operatingValue(u)) } }
                    Text(observation.limitation).font(.caption)
                }
            }
            if let overall = d.overallEvidence { Text(overall.explanation).foregroundStyle(Theme.gold).accessibilityIdentifier("phase6OverallReview") }
            ForEach((d.tests ?? []).isEmpty ? (d.observations ?? []) : [], id: \.metric) { observation in
                Text(operatingMetricTitle(observation.metric) + " · " + observation.direction).foregroundStyle(Theme.blue)
                Text("本期 " + operatingValue(observation.current) + " / 前期 " + operatingValue(observation.previous)).font(.caption)
                Text(observation.limitation).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            if !(d.conflictingEvidence ?? []).isEmpty { Text("证据方向存在冲突，未自动加权。").foregroundStyle(Theme.gold) }
            Text("支持：\(d.supporting.isEmpty ? "尚无确定性支持" : d.supporting.joined(separator: ", "))")
            Text("削弱：\(d.weakening.isEmpty ? "尚无确定性削弱" : d.weakening.joined(separator: ", "))")
            Text(d.explanation)
            Text("Most important counterevidence").font(.headline)
            if d.counterevidence.isEmpty { Text("未发现可靠反证 ≠ Thesis 已被证明") }
            ForEach(d.counterevidence.prefix(3), id: \.self) { id in
                if let material = api.templateFrozen?.data?.materials.first(where: { $0.id == id }) {
                    NavigationLink(material.title) { ClientPage(title: "反方证据") {
                        Text(material.contentText); Text("来源分类：" + material.claimType)
                        if let url = material.sourceUrl.flatMap(URL.init(string:)) { Link("打开原始来源", destination: url) }
                        if let citation = material.citation { Text("PDF \(citation.documentId) · 第 \(citation.pageNumber) 页") }
                    } }
                }
            }
            Text("UNKNOWN · " + d.unknown.joined(separator: "；")); Text("下一验证：" + d.nextValidationEvent)
            if let revision = v.model.thesisRevision {
                Divider(); Text("Owner 当前判断 · \(revision.status) · \(operatingAssessmentTitle(revision.assessment))").font(.headline)
                Text("旧理由：" + revision.previous.conditionText); Text("新理由：" + revision.newThesis)
                if revision.previous.conditionText != revision.newThesis { Text("当前继续研究的核心理由发生文本变化，请核对新增和放弃的假设。").foregroundStyle(Theme.gold) }
                Text("新增假设：" + revision.addedHypotheses.joined(separator: "；")); Text("放弃假设：" + revision.abandonedHypotheses.joined(separator: "；"))
                Text("修改原因：" + revision.reason); Text("验证节点：" + revision.previousValidationEvent + " → " + revision.nextValidationEvent)
            }
        } else { Text("UNBOUND · 尚未选择要检验的原假设") }
        if preview == nil { NavigationLink("选择原假设 / 编辑修订") { OperatingModelEditor(initial: v) } }
    } }
}
struct OperatingGuidanceView: View {
    let initial: ResearchOperatingReasoning
    var body: some View { OperatingBoundPage(initial: initial, title: "管理层指引与实际") { v in
        if (v.guidance ?? []).isEmpty { Text("EMPTY / UNKNOWN · 当前没有已核验并结构化的未来指引。不会将已发生业绩作为 Guidance。") }
        ForEach(v.guidance ?? [], id: \.guidanceId) { g in
            Text("GUIDANCE · \(operatingMetricTitle(g.metric)) · \(g.period)").font(.headline)
            Text("目标下界：\(operatingValue(g.lower, unit: "vehicles")) · 上界：\(operatingValue(g.upper, unit: "vehicles"))")
            Text("\(g.status) · 研究跟进日 \(g.expectedVerificationDate)"); Text(g.limitation)
            if let revision = g.revision { DisclosureGroup("Original / Updated Guidance") { Text("原指引：" + revision.previousStatement); Text("更新指引：" + revision.updatedStatement); Text(revision.reason); Text("来源材料：" + revision.sourceMaterialId + " · " + revision.recordedAt) } }
            if let fact = v.facts.first(where: { $0.id == g.guidanceId }) { NavigationLink("指引原文") { OperatingFactDetail(fact: fact) } }
        }
    } }
}

struct OperatingFactCandidatesView: View {
    let initial: ResearchOperatingReasoning
    var body: some View { OperatingBoundPage(initial: initial, title: "Fact Candidates") { value in
        Text("CANDIDATE ≠ FACT").foregroundStyle(Theme.gold)
        Text("从已导入材料提取候选；不会自动写入、重复录入或替换历史事实。").font(.caption)
        if (value.factCandidates ?? []).isEmpty { Text("当前未提取到有明确行列标签的候选，需要核对材料或新增来源。") }
        ForEach(value.factCandidates ?? []) { candidate in
            NavigationLink { ClientPage(title: "候选来源绑定") {
                Text("CANDIDATE · " + operatingMetricTitle(candidate.metric)).font(.headline)
                Text(candidate.proposedValue + " × " + candidate.unitScale.formatted() + " " + candidate.currency)
                Text("期间：" + (candidate.periodStart ?? candidate.periodEnd) + " 至 " + candidate.periodEnd)
                Text("行：" + candidate.rowLabelText); Text("列：" + candidate.columnHeaderText); Text("单位：" + candidate.unitHeaderText)
                Text("原始数字：" + candidate.rawValueText); Text(candidate.sourceExcerpt).textSelection(.enabled)
                Text("PDF " + candidate.documentId + " / 第 " + String(candidate.pageNumber) + " 页")
                Text(candidate.extractionMethod + " · " + candidate.confidence).font(.caption)
                Text(candidate.limitation).foregroundStyle(Theme.gold)
                NavigationLink("核对并确认候选") { OperatingCandidateConfirmation(candidate: candidate) }.accessibilityIdentifier("phase6ConfirmCandidateEntry")
                if let id = candidate.existingFactId { Text("已有事实 #" + id + "；仅建议核验升级，不重复写入") }
                if let url = URL(string: candidate.sourceUrl) { Link("打开原始公告", destination: url) }
            } } label: { OperatingCandidateListLabel(candidate:candidate) }.accessibilityIdentifier(candidate.mix == nil ? "phase5Candidate-" + candidate.metric : candidate.longitudinalIdentifier)
        }
    } }
}

struct OperatingResearchQuestionsView: View {
    let initial: ResearchOperatingReasoning
    var body: some View { OperatingBoundPage(initial: initial, title: "研究问题") { value in
        ForEach(value.researchQuestions ?? []) { question in
            Text(question.question).font(.headline)
            Text(question.status + " · " + (question.mismatchReason ?? question.gapReason ?? "证据已齐备")).foregroundStyle(Theme.gold)
            if let available=question.availableDependencies, let missing=question.missingDependencies, !missing.isEmpty { Text("已找到：" + available.joined(separator: "、") + "；仍缺：" + missing.joined(separator: "、")).font(.caption) }
            Text(question.resolution ?? (question.candidateIds.isEmpty ? "需要新来源或进一步核对已有材料" : "可能可从已有材料提取，候选尚不是 FACT"))
            if !question.candidateIds.isEmpty { NavigationLink("核对候选证据") { OperatingFactCandidatesView(initial: value) } }
            ForEach(value.facts.filter { question.evidenceIds.contains($0.id) }) { fact in NavigationLink("已关联证据 · " + operatingMetricTitle(fact.metric)) { OperatingFactDetail(fact: fact) } }
        }
    } }
}

struct DocumentFactCandidatesView: View {
    let symbol: String
    @ObservedObject private var api = OwnerClientStore.shared
    @State private var questions: [OperatingResearchQuestion] = []
    @State private var candidates: [OperatingFactCandidate] = []
    @State private var message = "正在核对文档范围…"
    private var identityKey: String { symbol + ":" + api.selectedSymbol + ":" + String(api.membershipEnvelope?.memberships.first(where: { $0.symbol == symbol })?.version ?? -1) }
    var body: some View { ClientPage(title: "文档中的事实候选") {
        Text(message).font(.caption)
        NavigationLink("记录一个研究问题") { OwnerResearchQuestionEditor(symbol: symbol) }
        ForEach(questions.filter { q in api.selectedSymbol == symbol && api.membershipEnvelope?.memberships.contains(where: { $0.id == q.membershipId && $0.version == q.membershipVersion }) == true }) { q in Text(q.question); Text(q.status + " · " + (q.mismatchReason ?? q.gapReason ?? "已有对应事实")).foregroundStyle(Theme.gold).accessibilityIdentifier("phase6DocumentQuestionStatus") }
        if api.selectedSymbol == symbol { ForEach(candidates.filter { c in api.membershipEnvelope?.memberships.contains(where: { $0.id == c.membershipId && $0.version == c.membershipVersion }) == true }) { c in NavigationLink { OperatingCandidateConfirmation(candidate: c) } label: { OperatingCandidateListLabel(candidate:c) }.accessibilityIdentifier(c.mix == nil ? "phase6DocumentCandidate-" + c.metric + "-p" + String(c.pageNumber) : c.longitudinalIdentifier) } }
    }.task(id: identityKey) { candidates = []; questions = []; guard api.selectedSymbol == symbol else { return }; do { candidates = try await api.factCandidates(symbol: symbol); questions = try await api.researchQuestions(symbol: symbol); message = "候选不是 FACT；从授权文档页提取，最多读取 24 个相关页。" } catch { message = (error as NSError).domain } } }
}
struct OperatingCandidateConfirmation: View {
    @State private var pdf: ResearchDocumentPDFPresentation?
    @FocusState private var editingField: String?
    let candidate: OperatingFactCandidate
    @State private var scope = ""
    @State private var accountingScope = "unknown"
    @State private var overrideKnownScope = false
    @State private var overrideReason = ""
    @State private var sourceURL = ""
    @State private var limitation = ""
    @State private var confirmedFields: Set<String> = []
    @State private var confirmed = false
    @State private var correction = false
    @State private var message = ""
    @State private var busy = false
    @State private var saved = false
    @State private var key = "candidate-confirm-" + UUID().uuidString
    @ObservedObject private var api = OwnerClientStore.shared
    var body: some View { Group {
        if api.selectedSymbol == candidate.symbol && api.membershipEnvelope?.memberships.contains(where: { $0.id == candidate.membershipId && $0.version == candidate.membershipVersion }) == true { editor }
        else { Text("研究范围或版本已变化，请重新打开候选。").foregroundStyle(Theme.gold) }
    } }
    private var editor: some View { Form {
        Section("候选 · 尚不是 FACT") { Text(operatingMetricTitle(candidate.metric) + " · " + candidate.rawValueText); Text(candidate.periodEnd + " · " + candidate.unitHeaderText); Text(candidate.classification ?? "CANDIDATE"); if candidate.confirmationAllowed == false { Text("该文档版本待审核；当前仅可预览，不能确认 FACT。").foregroundStyle(Theme.gold) }; if candidate.confirmationState == "already_confirmed" { Text("该数值已完成数字与结构确认，无需重复写入。").foregroundStyle(Theme.blue) }; Text(candidate.sourceExcerpt).textSelection(.enabled); Text("行：" + candidate.rowLabelText); Text("列：" + candidate.columnHeaderText); Text("单位：" + candidate.unitHeaderText); Text("第 \(candidate.pageNumber) 页"); DisclosureGroup("同表区域") { Text(candidate.structureExcerpt ?? "无法确定同表区域，不能直接确认") } }
        Button("打开已导入原始 PDF · 第 \(candidate.pageNumber) 页") { Task { do { pdf = try await api.candidatePDF(candidate) } catch { message = (error as NSError).domain } } }.accessibilityIdentifier("phase6CandidatePDF")
        Section("Owner 核对") {
            if candidate.businessScope != "unknown" {
                Text("模板识别业务范围：" + (candidate.businessScope ?? ""))
                Toggle("Override extracted scope · 我确认模板范围不正确", isOn:$overrideKnownScope)
                if overrideKnownScope { TextField("替换范围", text:$scope).accessibilityIdentifier("phase8OverrideScope"); TextField("更正理由", text:$overrideReason).accessibilityIdentifier("phase8OverrideReason") }
            } else { TextField("业务范围（按原文或明确映射）", text: $scope).focused($editingField, equals: "scope").autocorrectionDisabled().accessibilityIdentifier("phase6CandidateScope") }
            Text("文档捕获来源：" + (candidate.capturedSourceUrl ?? "Source URL not captured"))
            Picker("会计范围（须明确核对）", selection:$accountingScope) { Text("未知").tag("unknown"); Text("合并").tag("consolidated"); Text("母公司").tag("parent_company"); Text("分部").tag("segment") }
            Text("测量口径：" + (candidate.measurementBasis ?? "unknown"))
            TextField("Owner 补充参考 URL（非捕获来源）", text: $sourceURL).textInputAutocapitalization(.never).autocorrectionDisabled().focused($editingField, equals: "url").accessibilityIdentifier("phase6CandidateSourceURL")
            TextField("限制（未经审计、重列及口径）", text: $limitation).focused($editingField, equals: "limitation").accessibilityIdentifier("phase6CandidateLimitation")
            Text("仅勾选本人已核对的字段。服务器重新验证原文并记录确认者和时间。").font(.caption)
            ForEach(["metric", "period", "currency", "scope", "taxonomy"], id: \.self) { field in Toggle(field, isOn: Binding(get: { confirmedFields.contains(field) }, set: { if $0 { confirmedFields.insert(field) } else { confirmedFields.remove(field) } })).accessibilityIdentifier("phase6ConfirmField-" + field) }
            if candidate.classification == "POSSIBLE_CORRECTION" { Toggle("已比较旧值，明确确认本次更正", isOn: $correction) }
            Toggle("确认候选值、来源和限制", isOn: $confirmed).accessibilityIdentifier("phase6CandidateConfirmed")
            Button(saved ? "已保存新的事实版本" : "确认候选并保存") { Task { await save() } }.disabled(candidate.confirmationAllowed == false || !confirmed || scope.isEmpty || limitation.isEmpty || candidate.classification == "AMBIGUOUS" || candidate.confirmationState == "already_confirmed" || (overrideKnownScope && (overrideReason.count < 5 || scope == candidate.businessScope)) || busy || saved).accessibilityIdentifier("phase6CandidateSave")
            Text(message).font(.caption).accessibilityIdentifier("phase6CandidateStatus")
        }
    }.sheet(item: $pdf) { source in NavigationStack { ResearchDocumentPDFView(data: source.data, pageNumber: source.pageNumber).navigationTitle("原始 PDF · 第 \(source.pageNumber) 页").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .topBarTrailing) { Button("关闭原文") { pdf = nil } } } } }.scrollDismissesKeyboard(.interactively).toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("完成输入") { editingField = nil } } }.navigationTitle("确认事实候选").task { accountingScope = candidate.accountingScope ?? "unknown"; scope = candidate.businessScope == "unknown" ? "" : candidate.businessScope ?? "" } }
    @MainActor private func save() async {
        busy = true; defer { busy = false }
        let unit = candidate.unit ?? "unknown"
        var assertion: [String: Any] = ["unit":unit,"businessScope":scope,"measurementBasis":candidate.measurementBasis ?? "unknown","category":"actual","sourceUrl":sourceURL,"limitation":limitation,"sourceChecked":true,"structureConfirmation":["confirmedFields":confirmedFields.sorted()]]
        if let mix=candidate.mix, let encoded=try? JSONEncoder().encode(mix), let object=try? JSONSerialization.jsonObject(with:encoded) { assertion["mix"]=object }
        let value: [String: Any] = ["membershipVersion":candidate.membershipVersion,"sourceMaterialId":candidate.sourceMaterialId ?? "1","metric":candidate.metric,"periodKind":candidate.periodStart == nil ? "instant" : "duration","periodStart":candidate.periodStart as Any? ?? NSNull(),"periodEnd":candidate.periodEnd,"currency":candidate.currency,"unitScale":candidate.unitScale,"scope":accountingScope,"valueStatus":"reported","value":candidate.proposedValue,"comparability":"comparable","comparabilityReason":NSNull(),"amendmentKind":candidate.existingFactId == nil ? "initial" : "correction","replacesValueId":candidate.existingFactId as Any? ?? NSNull(),"ownerConfirmed":true,"idempotencyKey":key,"assertion":assertion]
        do { var request:[String:Any] = ["candidateId":candidate.id,"membershipVersion":candidate.membershipVersion,"ownerConfirmed":true,"correctionConfirmed":correction,"value":value]
            if overrideKnownScope, let original=candidate.businessScope, original != "unknown" { request["scopeOverride"]=["originalScope":original,"replacementScope":scope,"reason":overrideReason] }
            try await api.confirmFactCandidate(candidate, body:request); saved = true; message = "已保存。返回并重新读取研究，核对问题是否已有证据回答；原 Thesis 未修改。" } catch { message = (error as NSError).domain }
    }
}

struct OwnerResearchQuestionEditor: View {
    let symbol: String
    @State private var text = ""
    @State private var metric = "average_selling_price"
    @State private var start = ""
    @State private var end = ""
    @State private var scope = ""
    @State private var basis = "issuer_sales"
    @State private var currency = "CNY"
    @State private var unit = "currency_per_vehicle"
    @State private var unitScale = "1"
    @State private var accountingScope = "unknown"
    @State private var periodType = "monthly"
    @State private var message = ""
    @State private var saved = false
    @State private var key = "owner-question-" + UUID().uuidString
    var body: some View { Form {
        TextField("当前最值得核对的问题", text: $text)
        Picker("目标指标", selection: $metric) { ForEach(["average_selling_price", "revenue", "gross_margin", "operating_cash_flow", "core_profit_attributable_to_owners"], id: \.self) { Text(operatingMetricTitle($0)).tag($0) } }
        Picker("期间", selection: $periodType) { Text("单月").tag("monthly"); Text("半年").tag("interim"); Text("全年").tag("annual") }
        TextField("开始日期 YYYY-MM-DD", text: $start); TextField("结束日期 YYYY-MM-DD", text: $end)
        TextField("业务范围", text: $scope)
        Picker("口径", selection: $basis) { Text("发行人销量").tag("issuer_sales"); Text("财务报表").tag("financial_statement") }
        TextField("币种（无币种填写 XXX）",text:$currency)
        Picker("单位",selection:$unit) { Text("每辆货币金额").tag("currency_per_vehicle"); Text("货币金额").tag("currency"); Text("比例").tag("ratio"); Text("辆").tag("vehicles") }
        TextField("原文单位倍数",text:$unitScale).keyboardType(.decimalPad)
        Picker("会计范围",selection:$accountingScope) { Text("待明确").tag("unknown"); Text("合并").tag("consolidated"); Text("母公司").tag("parent_company"); Text("分部").tag("segment") }
        Button(saved ? "问题已记录" : "记录研究问题") { Task { do { try await OwnerClientStore.shared.saveResearchQuestion(symbol: symbol, question: ["questionId":key,"question":text,"targetMetric":metric,"period":["kind":"duration","type":periodType,"start":start,"end":end],"businessScope":scope,"measurementBasis":basis,"requirement":requirement], idempotencyKey: key); saved = true; message = "问题已记录到研究上下文的新版本。" } catch { message = (error as NSError).domain } } }.disabled(saved || text.isEmpty || scope.isEmpty || start.isEmpty || end.isEmpty)
        Text(message)
    }.navigationTitle("研究问题") }
    private var requirement: [String:Any] {
        let member=OwnerClientStore.shared.membershipEnvelope?.memberships.first { $0.symbol == symbol }
        let values:[String:Any] = ["symbol":symbol,"membershipVersion":member?.version ?? 0,"metric":metric,"period":["kind":"duration","type":periodType,"start":start,"end":end],"category":"actual","unit":unit,"currency":currency == "XXX" ? NSNull() : currency as Any,"accountingScope":accountingScope,"businessScope":scope,"measurementBasis":basis,"taxonomy":NSNull(),"guidanceDefinition":NSNull(),"shareBasis":NSNull(),"comparability":"comparable"]
        var result=values.mapValues { ["mode":"exact","value":$0] as [String:Any] }
        if accountingScope == "unknown" { result["accountingScope"]=["mode":"owner_to_define"] }
        return result
    }
}

struct OperatingEvidenceSeriesView: View {
    let initial: ResearchOperatingReasoning
    var body: some View { OperatingBoundPage(initial:initial,title:"历史序列") { v in
        Text("历史事实保留；来源修订与新期间分开记录。").font(.caption).foregroundStyle(Theme.textSecondary)
        ForEach((v.evidenceSeries ?? []).filter { ["revenue","gross_profit","gross_margin","core_profit_attributable_to_owners","profit_attributable_to_owners","operating_cash_flow","sales_volume","mix_share","issued_shares"].contains($0.identity.metric) && $0.identity.category == "actual" && $0.identity.symbol == v.symbol && $0.identity.membershipVersion == v.membershipVersion }) { series in
            NavigationLink { OperatingSeriesDetail(series:series,facts:v.assertionHistory ?? v.facts) } label: { OperatingSeriesSummary(series:series) }.accessibilityIdentifier("phase7Series-" + series.identity.metric + (series.shareBasis ?? ""))
        }
    } }
}
struct OperatingSeriesDetail: View {
    let series:OperatingEvidenceSeries; let facts:[OperatingFact]
    var body:some View { ScrollView { VStack(alignment:.leading,spacing:16) {
        Text(series.identity.businessScope + " · " + series.identity.accountingScope + " · " + series.identity.measurementBasis).font(.caption)
        ForEach(series.breaks,id:\.self) { Text($0).foregroundStyle(Theme.gold) }
        ForEach(Array(series.observations.enumerated()),id:\.offset) { _,o in
            Text(o.period.end + " · " + operatingValue(o.value,unit:series.identity.unit,currency:series.identity.currency)).font(.headline)
            Text(o.status + " · " + o.semanticType).font(.caption)
            if let formula=o.formula { Text(formula).font(.caption) }
            ForEach(facts.filter { o.inputs.contains($0.id) }) { f in NavigationLink("来源 · revision \(f.revision)") { OperatingFactDetail(fact:f) } }
            ForEach(facts.filter { o.historicalAssertionIds.contains($0.id) }) { f in NavigationLink("历史声明 · \(f.value.formatted()) · revision \(f.revision) · \(f.evidenceValidity ?? "UNKNOWN")") { OperatingFactDetail(fact:f) } }
        }
    }.padding(18).foregroundStyle(Theme.textPrimary) }.background(Theme.bgPrimary).navigationTitle(operatingMetricTitle(series.identity.metric)) }
}

struct OperatingSeriesSummary:View {
    let series:OperatingEvidenceSeries
    private var title:String { operatingMetricTitle(series.identity.metric) + (series.identity.taxonomy.map { " · " + $0.dimensionValue } ?? "") }
    private var comparison:String { (series.previous.map { operatingValue($0.value,unit:series.identity.unit,currency:series.identity.currency) } ?? "无上一可比值") + " → " + operatingValue(series.current?.value,unit:series.identity.unit,currency:series.identity.currency) }
    private var change:String { if series.previous == nil { return "尚无上一可比期间" }; if series.identity.unit == "ratio" { return "同口径 · " + (series.change.map { String(format:"%+.2fpp",$0 * 100) } ?? "UNKNOWN") }; return "同口径 · " + (series.changeRatio.map { String(format:"%+.2f%%",$0 * 100) } ?? "UNKNOWN") }
    var body:some View { VStack(alignment:.leading,spacing:8) { Text(title).fontWeight(.medium); Text(comparison).foregroundStyle(Theme.blue); Text(change).font(.caption); if let basis=series.shareBasis { Text(basis == "total" ? "占总销量" : "占父分类").font(.caption) } }.padding(12).background(Theme.bgSecondary,in:RoundedRectangle(cornerRadius:10)) }
}

extension OperatingFactCandidate {
    var longitudinalIdentifier:String { "phase7Candidate-" + (mix?.dimensionValue ?? metric) + "-" + periodEnd }
    var listTitle:String { operatingMetricTitle(metric) + " · " + (mix?.dimensionValue ?? "") }
    var listCaption:String { periodEnd + " · " + rawValueText + " · p" + String(pageNumber) }
}
struct OperatingCandidateListLabel:View {
    let candidate:OperatingFactCandidate
    var body:some View { VStack(alignment:.leading) { Text(candidate.listTitle); Text(candidate.classification ?? "CANDIDATE").font(.caption); Text(candidate.listCaption).font(.caption).foregroundStyle(Theme.textSecondary) } }
}
