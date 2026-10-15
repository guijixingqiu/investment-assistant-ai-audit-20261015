import Foundation
import SwiftUI

struct ProviderOperatingReferenceView: View {
    let membership: CandidateMembershipData?
    let reference: ResearchProviderOperatingReference?
    let onPrepareLimitedResearch: () -> Void

    init(membership: CandidateMembershipData? = nil, reference: ResearchProviderOperatingReference?,
         onPrepareLimitedResearch: @escaping () -> Void) {
        self.membership = membership
        self.reference = reference
        self.onPrepareLimitedResearch = onPrepareLimitedResearch
    }

    @ObservedObject private var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    @State private var history: FutuFinancialHistory?
    @State private var historyMessage = "正在读取当前公司的已存财务参考。"
    @State private var readingHistory = false
    @State private var openingOriginal = false
    @State private var originalMessage: String?
    @State private var originalRevision = UUID()
    @State private var openedOriginal: OpenedOriginal?

    private let metrics = [
        "revenue", "profit_attributable_to_owners", "operating_cash_flow",
        "total_assets", "total_liabilities"
    ]

    private struct OpenedOriginal: Identifiable {
        let id = UUID()
        let page: FutuFinancialPage
        let report: FutuFinancialReport
        let summary: FutuFinancialSummary
        let periodEnd: String
        let financialType: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("五年财务与中期 · \(currentMembership?.symbol ?? reference?.symbol ?? "当前公司")")
                    .font(.title2.bold())
                Text("已存 OpenD 第三方财务摘要，每期只列五项指标；三张报表请逐页查看提供商原件。发行人核验、重述可比性与最新应披露期间均未知。")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("providerOperatingBoundary")

                if currentMembership == nil {
                    Text("当前公司的研究成员身份已变化；请返回并重新读取公司资料。")
                        .font(.callout).foregroundStyle(.orange)
                } else if readingHistory {
                    ProgressView("正在读取已存原值")
                } else if let history {
                    financialReadout(history)
                } else {
                    Text(historyMessage).font(.callout).foregroundStyle(.secondary)
                    Button("重新读取财务参考") { Task { await loadHistory() } }
                        .buttonStyle(.bordered)
                    operatingJourney(financialHistory: nil)
                }

                if let context = matchingReference?.ownerContext {
                    DisclosureGroup("另存的 KPI、Owner 假设与核验问题") {
                        separateContext(context)
                    }
                } else {
                    Text("当前没有可读取的同公司 KPI／Owner 假设上下文；OpenD 原值仍可独立查看。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("前往有限研究准备页") { onPrepareLimitedResearch() }
                    .buttonStyle(.borderedProminent)
                    .disabled(currentMembership == nil)
                Text("这里只打开准备入口；不会创建研究任务、发送数据或写入正式财务事实。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("财务参考")
        .task(id: "\(currentMembership?.id ?? "none"):\(currentMembership?.version ?? 0):\(api.authorizationRevision)") {
            await loadHistory()
        }
        .sheet(item: $openedOriginal) { item in
            originalSheet(item)
        }
    }

    private var currentMembership: CandidateMembershipData? {
        guard let candidate = membership ?? api.membershipEnvelope?.memberships.first(where: {
            $0.id == reference?.membershipId && $0.version == reference?.membershipVersion
                && $0.symbol == reference?.symbol
        }) else { return nil }
        return api.membershipEnvelope?.memberships.first {
            $0.id == candidate.id && $0.version == candidate.version
                && $0.actorId == candidate.actorId && $0.symbol == candidate.symbol
                && $0.state == .tracked
        }
    }

    private var matchingReference: ResearchProviderOperatingReference? {
        guard let membership = currentMembership else { return nil }
        guard let reference, reference.membershipId == membership.id,
              reference.membershipVersion == membership.version,
              reference.symbol == membership.symbol else { return nil }
        return reference
    }

    @ViewBuilder
    private func financialReadout(_ history: FutuFinancialHistory) -> some View {
        if history.annualCaptureId == nil {
            Text("当前成员尚无已存年度三表捕获；不能判断近五年覆盖。")
                .font(.callout).foregroundStyle(.secondary)
        } else {
            annualChanges(history)
        }
        operatingJourney(financialHistory: history)
        if history.annualCaptureId != nil { annualTable(history) }

        VStack(alignment: .leading, spacing: 8) {
            Text("最近已存累计半年").font(.headline)
            if history.halfYearCaptureId == nil || history.halfYearPeriodEnds.isEmpty {
                Text("尚无当前成员的已存累计半年三表；年度数据不能代替中期。")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                if let latest = history.latestHalfYearPeriodEnd {
                    Text("最近已观察：截至 \(latest)。这不证明它是最新应披露期。")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(history.halfYearPeriodEnds, id: \.self) { end in
                    periodCard(history, financialType: "Q6", end: end,
                        title: "\(end.prefix(4)) 上半年累计\(end == history.latestHalfYearPeriodEnd ? "" : " · 上年同期")")
                }
            }
        }
        .accessibilityIdentifier("providerOperatingInterim")

        if history.annualCaptureId != nil || history.halfYearCaptureId != nil {
            DisclosureGroup("逐期打开三表原件") {
                ForEach(history.annualPeriodEnds, id: \.self) { end in
                    originalButtons(financialType: "ANNUAL", end: end, title: "\(end.prefix(4)) 年度")
                }
                ForEach(history.halfYearPeriodEnds, id: \.self) { end in
                    originalButtons(financialType: "Q6", end: end, title: "\(end.prefix(4)) 上半年累计")
                }
                if openingOriginal { ProgressView("正在核对原件") }
                if let originalMessage {
                    Text(originalMessage).font(.caption).foregroundStyle(.orange)
                }
            }
        }

        DisclosureGroup("来源、缺口与可比性限制") {
            Text("成员 \(history.membershipId) v\(history.membershipVersion) · \(history.symbol)；已存年度捕获 #\(history.annualCaptureId ?? "无")，累计半年捕获 #\(history.halfYearCaptureId ?? "无")。")
            Text("五项指标是提供商原值摘要，不代表五年完整发行人财报；币种相同也不证明重述版本或业务口径可比。")
            ForEach(history.comparisonNotices) { notice in
                VStack(alignment: .leading, spacing: 3) {
                    Text("已知版本差异：\(notice.text)")
                    if let url = URL(string: notice.sourceUrl) {
                        Link("查看对应公开披露", destination: url)
                    }
                }
            }
            ForEach(history.gaps, id: \.self) { gap in Text("待补：\(gap)") }
            ForEach(history.captureLimitations ?? [], id: \.self) { gap in
                Text("整次捕获／更老期间限制：\(gap)")
            }
            if history.captureLimitations == nil {
                Text("旧版读取未单列整次捕获限制；不能据此认为更老历史完整。")
            }
        }
        .font(.caption).foregroundStyle(.secondary)
    }

    private func annualTable(_ history: FutuFinancialHistory) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("近五年已存年度指标").font(.headline)
            Text("各格分别标明币种与金额单位；空缺保持空缺。横向查看 2021—2025 等实际已观察期间。")
                .font(.caption).foregroundStyle(.secondary)
            if history.annualPeriodEnds.isEmpty {
                Text("没有可确定的年度期间。").font(.callout).foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 0) {
                            tableCell("指标", width: 112, headline: true)
                            ForEach(history.annualPeriodEnds, id: \.self) { end in
                                tableCell(String(end.prefix(4)) + " 年", width: 144, headline: true)
                            }
                        }
                        Divider()
                        ForEach(metrics, id: \.self) { metric in
                            HStack(spacing: 0) {
                                tableCell(metricName(metric), width: 112, headline: true)
                                ForEach(history.annualPeriodEnds, id: \.self) { end in
                                    let value = metricValue(history, metric: metric,
                                        financialType: "ANNUAL", end: end)
                                    tableCell(value.map { amount($0.rawValue, currency: $0.currencyCode) } ?? "缺项",
                                        width: 144, headline: false)
                                }
                            }
                            Divider()
                        }
                    }
                }
                .accessibilityIdentifier("providerOperatingFiveYearTable")
                Text("展示的是已核对原件的五项提供商值，金额按基础货币单位换算显示；准确原字符串和字段位置见逐期详情。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func tableCell(_ text: String, width: CGFloat, headline: Bool) -> some View {
        Text(text)
            .font(headline ? .caption.bold() : .caption.monospacedDigit())
            .foregroundStyle(text == "缺项" ? Color.orange : Color.primary)
            .frame(width: width, alignment: .leading)
            .frame(minHeight: 42, alignment: .leading)
            .padding(.horizontal, 5)
    }

    private func annualChanges(_ history: FutuFinancialHistory) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("最近两年度原值变化").font(.headline)
            Text("只计算相邻年度同币种、同期间类型的已存值；重述可比性仍未知。")
                .font(.caption).foregroundStyle(.secondary)
            if history.annualPeriodEnds.count >= 2 {
                let latest = history.annualPeriodEnds[0], previous = history.annualPeriodEnds[1]
                ForEach(metrics, id: \.self) { metric in
                    let current = metricValue(history, metric: metric, financialType: "ANNUAL", end: latest)
                    let prior = metricValue(history, metric: metric, financialType: "ANNUAL", end: previous)
                    HStack(alignment: .firstTextBaseline) {
                        Text(metricName(metric))
                        Spacer(minLength: 8)
                        Text(change(current: current, prior: prior, latest: latest, previous: previous))
                            .monospacedDigit()
                    }
                    .font(.callout)
                }
            } else {
                Text("已存年度不足两期，无法比较变化。")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func operatingJourney(financialHistory: FutuFinancialHistory?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("经营解释与下一步").font(.headline)
            if let membership = currentMembership,
               let reasoning = api.boundOperatingReasoning(symbol: membership.symbol),
               reasoning.actorId == membership.actorId,
               reasoning.membershipId == membership.id,
               reasoning.membershipVersion == membership.version {
                let changedFact = reasoning.publicResearchChangeFact
                let explanationApplies = reasoning.researchUpdate?.change?.triggerType != "verification_upgrade"
                    && (changedFact == nil || changedFact?.id == reasoning.fact.id)
                Text(reasoning.publicResearchChangeLabel ?? "另存的公司经营研究草稿")
                    .font(.subheadline.weight(.semibold))
                Text("主事实：\(reasoning.fact.text)")
                    .font(.callout)
                Text("原事实截至 \(reasoning.fact.period.end) · 发布 \(reasoning.fact.source.publishedAt.prefix(10))。来源、结构及核验状态请在经营详情中逐项重开。")
                    .font(.caption).foregroundStyle(.secondary)
                if let financialHistory {
                    let sameEndDate = (financialHistory.annualPeriodEnds
                        + financialHistory.halfYearPeriodEnds).contains(reasoning.fact.period.end)
                    Text(sameEndDate
                         ? "该事实与一项 OpenD 期间的截至日相同，但两条来源与会计口径独立；不能据此认定本页财务变化的原因。"
                         : "该事实与本页已存 OpenD 期间未对齐；以下解释须分别阅读，不能作为本页变动的归因。")
                        .font(.caption).foregroundStyle(.orange)
                } else {
                    Text("OpenD 财务参考尚未读到；以下解释仅属于其自身已存事实。")
                        .font(.caption).foregroundStyle(.orange)
                }
                if explanationApplies {
                    Text("已存解释候选：\(reasoning.operatingMeaning.text)")
                        .font(.callout)
                    Text("盈利传导边界：\(reasoning.profitTransmission.text)")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(reasoning.researchUpdate?.change?.triggerType == "verification_upgrade"
                         ? "本次仅升级来源核对，未产生新的经营传导。"
                         : "本次资料变化涉及另一指标；旧解释不能直接套用，经营原因待核查。")
                        .font(.callout).foregroundStyle(.orange)
                }
                if let impact = reasoning.thesisImpact, explanationApplies {
                    Text("对原假设的草稿评估：\(impact.explanation)")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("当前没有可直接用于这次变化的原假设评估。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let risk = reasoning.thesisUpdate?.counterevidence.first {
                    Text("已存反证条件：\(risk)")
                        .font(.caption).foregroundStyle(.orange)
                } else {
                    Text("原假设反证尚未记录；不能视为零风险。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("仍待核查：\(reasoning.unknown.text)")
                    .font(.caption).foregroundStyle(.orange)
                if let gap = reasoning.gaps?.first {
                    Text("资料缺口：\(gap.reason)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("下一问题：\(reasoning.nextResearchQuestion)")
                    .font(.callout.weight(.medium))
                NavigationLink {
                    ResearchOperatingReasoningView(initial: reasoning)
                } label: {
                    Text("核对完整经营解释与原件")
                }
                .accessibilityIdentifier("providerOperatingReasoningEntry")
            } else {
                Text("当前公司没有可读取的同成员经营解释；已存财务原值说明发生了什么，原因、传导和风险仍待来源核查。")
                    .font(.callout).foregroundStyle(.secondary)
                if let condition = matchingReference?.ownerContext?.counterEvidence.first?.conditionText {
                    Text("另存的反证条件：\(condition)。尚未证明与本页 OpenD 变化同一来源或期间。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let question = matchingReference?.ownerContext?.questions.first?.question {
                    Text("已有下一核验问题：\(question)")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if currentMembership != nil {
                Divider()
                Text("接下来核对估值条件，再写自己的判断").font(.subheadline.weight(.semibold))
                Text("估值情景包含 Owner 假设；不存在或失效的方法仍以估值页实际状态为准。普通判断由你明确选择来源并保存。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("查看已存估值情景") { actions.workflow(.valuation) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("providerOperatingValuationEntry")
                Button("记录我的普通判断") { actions.workflow(.manualResearch) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("providerOperatingManualJudgmentEntry")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("providerOperatingJourney")
    }

    private func periodCard(_ history: FutuFinancialHistory, financialType: String,
                            end: String, title: String) -> some View {
        DisclosureGroup(title) {
            let values = history.values.filter { $0.financialType == financialType && $0.periodEnd == end }
            ForEach(metrics, id: \.self) { metric in
                if let value = values.first(where: { $0.metric == metric }) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(metricName(metric))
                        Spacer(minLength: 8)
                        Text(amount(value.rawValue, currency: value.currencyCode)).monospacedDigit()
                    }
                    DisclosureGroup("原值与位置 · \(metricName(metric))") {
                        Text("提供商原值：\(value.rawValue) \(value.currencyCode) · \(value.periodText)")
                        Text("\(value.periodKind == "instant" ? "期末时点" : "期间 \(value.periodStart ?? "UNKNOWN") 至") \(value.periodEnd) · \(value.statementType.title) · 字段 \(value.fieldId)")
                        Text("捕获 #\(value.source.captureId) · 页 #\(value.source.pageId) · 原响应 SHA-256 \(value.source.rawSha256)")
                            .textSelection(.enabled)
                        Text("本期报表 SHA-256 \(value.source.reportSha256)").textSelection(.enabled)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("\(metricName(metric))：缺项").foregroundStyle(.orange)
                }
            }
        }
        .font(.callout)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("providerOperatingPeriod-\(financialType):\(end)")
    }

    private func originalButtons(financialType: String, end: String, title: String) -> some View {
        DisclosureGroup(title) {
            ForEach(FutuFinancialTable.allCases, id: \.rawValue) { table in
                Button("打开\(table.title)原件") {
                    Task { await openOriginal(financialType: financialType, end: end, table: table) }
                }
                .disabled(openingOriginal)
                .accessibilityIdentifier("providerOriginal-\(financialType)-\(end)-\(table.rawValue)")
            }
        }
    }

    private func originalSheet(_ item: OpenedOriginal) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(item.page.statementType.title) · \(item.financialType == "ANNUAL" ? "年度" : "累计半年") · \(item.periodEnd)")
                        .font(.headline)
                    Text("OpenD 提供商原始响应；表内金额单位倍率、合并口径和发行人核验状态仍须独立确认。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(item.report.item_list.enumerated()), id: \.offset) { _, row in
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.display_name)
                            Spacer(minLength: 8)
                            Text(row.data.map { String($0) } ?? "未提供").monospacedDigit()
                        }
                        .font(.callout)
                        Divider()
                    }
                    DisclosureGroup("精确原件身份") {
                        Text("成员 \(currentMembership?.id ?? "UNKNOWN") v\(currentMembership?.version ?? 0) · \(currentMembership?.symbol ?? "UNKNOWN")")
                        Text("捕获 #\(item.page.captureId) · 第 \(item.page.pageNumber) 页 · 页 #\(item.page.id)")
                        Text("原响应 SHA-256 \(item.page.rawSha256)").textSelection(.enabled)
                        Text("本期报表 SHA-256 \(item.summary.reportSha256)").textSelection(.enabled)
                    }
                    .font(.caption)
                }
                .padding()
            }
            .navigationTitle("三表原件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("完成") { openedOriginal = nil }
            } }
        }
    }

    @MainActor
    private func loadHistory() async {
        let revision = UUID()
        originalRevision = revision
        history = nil
        openedOriginal = nil
        originalMessage = nil
        readingHistory = true
        historyMessage = "正在读取当前公司的已存财务参考。"
        guard let membership = currentMembership else {
            readingHistory = false
            historyMessage = "当前公司的研究成员身份不可读取。"
            return
        }
        let auth = AppEnvironment.researchAuthorizationContext()
        do {
            let result = try await ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
                authHeaderName: auth.readHeaderName).readFutuFinancialHistory(membership: membership)
            guard !Task.isCancelled, originalRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext() else { return }
            history = result
            readingHistory = false
            historyMessage = ""
        } catch {
            guard !Task.isCancelled, originalRevision == revision else { return }
            history = nil
            readingHistory = false
            historyMessage = "已存财务参考读取失败；旧公司数据已清除。请稍后重试。"
        }
    }

    @MainActor
    private func openOriginal(financialType: String, end: String, table: FutuFinancialTable) async {
        guard let membership = currentMembership else { return }
        guard let history, !openingOriginal, history.membershipId == membership.id,
              history.membershipVersion == membership.version, history.symbol == membership.symbol else { return }
        let captureId = financialType == "ANNUAL" ? history.annualCaptureId : history.halfYearCaptureId
        guard let captureId else {
            originalMessage = "这个期间没有已存三表捕获。"
            return
        }
        let revision = UUID()
        originalRevision = revision
        openingOriginal = true
        originalMessage = nil
        openedOriginal = nil
        let auth = AppEnvironment.researchAuthorizationContext()
        defer { if originalRevision == revision { openingOriginal = false } }
        do {
            let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken,
                authHeaderName: auth.readHeaderName)
            let capture = try await client.readFutuFinancialCapture(membership: membership, captureId: captureId)
            guard capture.membershipVersion == membership.version,
                  capture.periodSelection == (financialType == "ANNUAL" ? "annual" : "half_year") else {
                originalMessage = "捕获所属成员版本或期间类型已变化，不能打开。"
                return
            }
            let matches = capture.pages.flatMap { page in
                page.reports.enumerated().compactMap { index, report -> (FutuFinancialPage, Int, FutuFinancialSummary)? in
                    guard page.statementType == table, report.financialType == financialType,
                          report.periodEnd == end else { return nil }
                    return (page, index, report)
                }
            }
            guard matches.count == 1 else {
                originalMessage = "这个期间的\(table.title)缺失或重复，无法确定唯一原件。"
                return
            }
            let (page, index, summary) = matches[0]
            let citedValues = history.values.filter {
                $0.financialType == financialType && $0.periodEnd == end && $0.statementType == table
            }
            guard page.originalAvailability == "available",
                  citedValues.allSatisfy({
                      $0.source.captureId == captureId && $0.source.pageId == page.id
                          && $0.source.rawSha256 == page.rawSha256
                          && $0.source.reportSha256 == summary.reportSha256
                  }) else {
                originalMessage = "原件不可读取或与当前摘要来源不一致。"
                return
            }
            let verified = try await client.readFutuFinancialOriginal(membership: membership,
                capture: capture, page: page)
            guard !Task.isCancelled, originalRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext(),
                  index < verified.body.report_list.count else { return }
            openedOriginal = OpenedOriginal(page: page, report: verified.body.report_list[index], summary: summary,
                periodEnd: end, financialType: financialType)
        } catch {
            guard !Task.isCancelled, originalRevision == revision else { return }
            originalMessage = "原件缺失、损坏或连接不可用；没有沿用旧原件。"
        }
    }

    private func metricValue(_ history: FutuFinancialHistory, metric: String,
                             financialType: String, end: String) -> FutuFinancialHistoryValue? {
        history.values.first {
            $0.metric == metric && $0.financialType == financialType && $0.periodEnd == end
        }
    }

    private func change(current: FutuFinancialHistoryValue?, prior: FutuFinancialHistoryValue?,
                        latest: String, previous: String) -> String {
        guard let current, let prior, current.currencyCode == prior.currencyCode,
              current.periodKind == prior.periodKind,
              current.financialType == "ANNUAL", prior.financialType == "ANNUAL",
              Int(latest.prefix(4)).map({ $0 - 1 }) == Int(previous.prefix(4)),
              latest.hasSuffix("-12-31"), previous.hasSuffix("-12-31"),
              (current.periodKind == "instant"
                  ? current.periodStart == nil && prior.periodStart == nil
                  : current.periodKind == "duration"
                      && current.periodStart == "\(latest.prefix(4))-01-01"
                      && prior.periodStart == "\(previous.prefix(4))-01-01"),
              let currentAmount = Decimal(string: current.rawValue, locale: Locale(identifier: "en_US_POSIX")),
              let priorAmount = Decimal(string: prior.rawValue, locale: Locale(identifier: "en_US_POSIX"))
        else { return "缺少同口径已存值" }
        let delta = currentAmount - priorAmount
        let magnitude = delta < 0 ? -delta : delta
        let direction = delta > 0 ? "增加" : delta < 0 ? "减少" : "持平"
        return direction == "持平" ? direction : "\(direction)\(amount(NSDecimalNumber(decimal: magnitude).stringValue, currency: current.currencyCode))"
    }

    private func amount(_ raw: String, currency: String) -> String {
        let namedUnit: String
        switch currency {
        case "CNY": namedUnit = "元"
        case "HKD": namedUnit = "港元"
        case "USD": namedUnit = "美元"
        default: namedUnit = currency
        }
        let codeLabel = namedUnit == currency ? "" : "（\(currency)）"
        guard let value = Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX")) else {
            return "\(raw) \(currency)"
        }
        let magnitude = value < 0 ? -value : value
        if magnitude > 0 && magnitude < 1 { return "\(raw) \(namedUnit)\(codeLabel)" }
        let divisor: Decimal
        let unit: String
        if magnitude >= 100_000_000 {
            divisor = 100_000_000; unit = "亿"
        } else if magnitude >= 10_000 {
            divisor = 10_000; unit = "万"
        } else {
            divisor = 1; unit = ""
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = divisor == 1 ? 6 : 2
        let displayed = formatter.string(from: NSDecimalNumber(decimal: value / divisor)) ?? raw
        return "\(divisor == 1 ? "" : "约")\(displayed) \(unit)\(namedUnit)\(codeLabel)"
    }

    private func metricName(_ metric: String) -> String {
        switch metric {
        case "revenue": "营业总收入"
        case "profit_attributable_to_owners": "归母净利润"
        case "operating_cash_flow": "经营现金流净额"
        case "total_assets": "总资产"
        case "total_liabilities": "总负债"
        default: metric
        }
    }

    private func separateContext(_ context: ProviderOperatingOwnerContext) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("已有研究上下文").font(.headline)
            DisclosureGroup("KPI（\(context.kpis.count)）") {
                ForEach(context.kpis) { kpi in
                    Text("\(kpi.metric)：\(kpi.value ?? "UNKNOWN") \(kpi.unit) · \(kpi.periodStart) 至 \(kpi.periodEnd) · \(kpi.comparability == "comparable" ? "可比性待逐项核对" : "不可比：\(kpi.comparabilityReason ?? "原因未注明")")")
                        .font(.caption)
                }
            }
            DisclosureGroup("Owner 假设（\(context.ownerAssumptions.count)）") {
                ForEach(Array(context.ownerAssumptions.enumerated()), id: \.offset) { _, input in
                    Text("\(input.scenario) · \(input.metric)：\(input.value) \(input.unit) · \(input.periodEnd) · \(input.note)")
                        .font(.caption)
                }
            }
            DisclosureGroup("反证条件（\(context.counterEvidence.count)）") {
                ForEach(context.counterEvidence) { test in
                    Text("\(test.conditionText) · 检查 \(test.metrics.joined(separator: "、")) · \(test.status)")
                        .font(.caption)
                }
            }
            DisclosureGroup("下一核验问题（\(context.questions.count)）") {
                ForEach(context.questions) { question in
                    Text(question.question).font(.caption)
                }
            }
            if !context.unknowns.isEmpty {
                DisclosureGroup("现存未知（\(context.unknowns.count)）") {
                    ForEach(context.unknowns, id: \.self) { Text($0).font(.caption) }
                }
            }
            Text("这些 KPI 和 Owner 假设与第三方财务原值分别保存；页面不会据此自动确认经营结论。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
