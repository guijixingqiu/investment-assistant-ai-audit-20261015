import SwiftUI
struct MarketDiscoveryContinuationToken: Equatable {
    let generation: UUID
    let authorizationContext: AppResearchAuthorizationContext
    let laneFetchedAt: String
    let identityFingerprint: String
}
struct MarketDiscoveryCard: View {
    let refreshRevision: UInt64
    let noticeSymbol: String
    let onSelectCandidate: (String) -> Void
    let onImportAnnouncement: ((OfficialAnnouncementDiscoveryItem, MarketDiscoveryContinuationToken) async -> Void)?
    let onOpenAnnouncement: ((OfficialAnnouncementDiscoveryItem) -> Void)?
    let onVerifyNoticeLead: ((NoticeLeadResearchHandoff) -> Void)?
    let onOpenQualifiedCandidate: ((MarketDiscoveryQualificationEnvelope, MarketDiscoveryContinuationToken) async -> Void)?
    let onDiscoveryGenerationChanged: ((UUID) -> Void)?
    let excludedAnnouncementId: String?
    let qualifiedActionTitle: String
    @State private var envelope: MarketDiscoveryEnvelope?
    @State private var qualification: MarketDiscoveryQualificationEnvelope?
    @State private var qualificationTargetSymbol: String?
    @State private var qualificationError: String?
    @State private var isLoading = false
    @State private var isQualifying = false
    @State private var isOpeningQualifiedCandidate = false
    @State private var isContinuingAnnouncement = false
    @State private var localRefreshRevision: UInt64 = 0
    @State private var loadGeneration = UUID()

    init(
        refreshRevision: UInt64,
        noticeSymbol: String = "HK.00175",
        onSelectCandidate: @escaping (String) -> Void,
        onImportAnnouncement: ((OfficialAnnouncementDiscoveryItem, MarketDiscoveryContinuationToken) async -> Void)?,
        onOpenAnnouncement: ((OfficialAnnouncementDiscoveryItem) -> Void)? = nil,
        onVerifyNoticeLead: ((NoticeLeadResearchHandoff) -> Void)? = nil,
        onOpenQualifiedCandidate: ((MarketDiscoveryQualificationEnvelope, MarketDiscoveryContinuationToken) async -> Void)? = nil,
        onDiscoveryGenerationChanged: ((UUID) -> Void)? = nil,
        excludedAnnouncementId: String? = nil,
        qualifiedActionTitle: String = "确认并继续研究"
    ) {
        self.refreshRevision = refreshRevision
        self.noticeSymbol = noticeSymbol
        self.onSelectCandidate = onSelectCandidate
        self.onImportAnnouncement = onImportAnnouncement
        self.onOpenAnnouncement = onOpenAnnouncement
        self.onVerifyNoticeLead = onVerifyNoticeLead
        self.onOpenQualifiedCandidate = onOpenQualifiedCandidate
        self.onDiscoveryGenerationChanged = onDiscoveryGenerationChanged
        self.excludedAnnouncementId = excludedAnnouncementId
        self.qualifiedActionTitle = qualifiedActionTitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("今日发现")
                        .font(.headline)
                    Text("官方港股通股票池 × 行情筛选 + OpenD 公告/重大新闻线索；不是推荐。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isLoading { ProgressView() }
            }

            if let envelope {
                MarketDiscoveryEligibilityView(eligibility: envelope.eligibility)
                candidateContent(envelope.candidates)
                noticeLeadContent(envelope.notices)
                announcementContent(envelope.announcements)
                Text(envelope.status == .available
                     ? "OpenD 信息只是未核验线索；官方 PDF 或人工核验后明确保存的事实才进入研究。"
                     : "今日发现部分来源不可用；已保留可验证的股票池身份，没有展示旧候选或未核验事实。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else if !isLoading {
                Text("候选理由暂不可用；今日发现没有返回可核对的筛选结果，也没有用旧结果补齐理由。")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("marketSelectedCandidateReason")
            }

            Button {
                localRefreshRevision &+= 1
            } label: {
                Label("刷新今日发现", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .disabled(isLoading || isQualifying || isOpeningQualifiedCandidate || isContinuingAnnouncement)
            .accessibilityIdentifier("marketDiscoveryRefresh")
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketDiscoveryCard")
        .task(id: "\(refreshRevision):\(localRefreshRevision):\(noticeSymbol)") {
            await load()
        }
    }

    @ViewBuilder
    private func noticeLeadContent(_ lane: NoticeLeadDiscoveryLane) -> some View {
        DisclosureGroup("\(lane.requestedSymbol) OpenD 信息线索 · \(lane.items.count)") {
            VStack(alignment: .leading, spacing: 10) {
                Text("只显示标题、来源、发布时间、关联标的和 URL；不是官方全文，也不是已核验事实。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("OpenD 读取时间 \(lane.fetchedAt ?? "不可用")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if lane.status == .unavailable {
                    Text("OpenD 公告/重大新闻线索暂不可用；没有展示旧线索。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    ForEach(lane.items) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.kind == "notice" ? "公告线索" : "重大新闻线索")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.orange)
                            Text("\(item.source) · \(item.publishedAt)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(item.title)
                                .font(.callout.weight(.semibold))
                            Text("建议带入：\(noticeLeadEventKindLabel(ResearchEventCaptureDraft.suggestedEventKind(for: item)))；仍需人工核验")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text("查询标的：\(item.symbol)；来源关联：\(item.relatedSecurities.isEmpty ? "未返回" : item.relatedSecurities.joined(separator: ", "))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let url = item.externalURL {
                                Link("打开未核验线索 URL", destination: url)
                                    .buttonStyle(.bordered)
                            }
                            if let onVerifyNoticeLead,
                               let handoff = NoticeLeadResearchHandoff(item: item, fetchedAt: lane.fetchedAt) {
                                Button("带到研究人工核验") {
                                    onVerifyNoticeLead(handoff)
                                }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier("marketDiscoveryVerifyNoticeLead-\(item.id)")
                            }
                            Text("打开后请核对原始来源；公告优先匹配发行人/HKEX 官方 PDF，新闻只能由你明确保存为未独立核验材料。不会自动下载、冻结或运行 AI。")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("marketDiscoveryNoticeLead-\(item.id)")
                    }
                }
            }
            .padding(.top, 6)
        }
    }

    @ViewBuilder
    private func candidateContent(_ lane: CandidateDiscoveryLane) -> some View {
        Group {
            if let candidate = lane.candidates.first(where: { $0.symbol == noticeSymbol }) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(noticeSymbol) 候选理由")
                        .font(.subheadline.weight(.semibold))
                    Text(candidate.why)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("marketSelectedCandidateReason")
            } else {
                Text("\(noticeSymbol) 候选理由暂未返回；当前发现没有这只股票的可追溯入选理由。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("marketSelectedCandidateReason")
            }
        }
        DisclosureGroup("港股研究候选 · \(lane.candidates.count)") {
            VStack(alignment: .leading, spacing: 10) {
                Text(lane.rule.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if lane.status == .unavailable {
                    Text("行情筛选暂不可用；没有展示旧候选。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    if let universe = lane.universe {
                        Text("港股通股票池 \(universe.effectiveDate) · \(universe.memberCount) 只 · 版本 \(universe.snapshotId.prefix(12))")
                            .font(.caption.weight(.semibold))
                        Text("来源：上交所与深交所官方港股通标的名单；候选只取两份名单身份一致的普通股票。")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Text("OpenD 基础筛选匹配 \(lane.totalMatched ?? 0) 只；与官方股票池相交后当前显示 \(lane.candidates.count) 只。5 日涨跌幅排序只用于发现变化，不代表优先级或预期收益。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("数据读取时间 \(lane.fetchedAt ?? "不可用")")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    ForEach(lane.candidates) { candidate in
                        VStack(alignment: .leading, spacing: 8) {
                            Button {
                                selectCandidate(candidate.symbol)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("\(candidate.symbol) · \(candidate.name)")
                                            .font(.callout.weight(.semibold))
                                        Spacer()
                                        Text("\(candidate.fiveDayChangePercent, format: .number.precision(.fractionLength(1)))%")
                                            .font(.caption.monospacedDigit())
                                    }
                                    Text("现价 \(candidate.price, format: .number.precision(.fractionLength(2))) · 市值 \(marketDiscoveryCompact(candidate.marketCap)) · 20日均成交额 \(marketDiscoveryCompact(candidate.average20DayTurnover))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Text("候选快照截止 \(candidate.asOf)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text(candidate.why)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("marketDiscoveryCandidate-\(candidate.symbol)")
                            if onOpenQualifiedCandidate != nil {
                                HStack {
                                    Button {
                                        Task { await qualify(candidate, lane: lane) }
                                    } label: {
                                        Label(
                                            isQualifying && qualificationTargetSymbol == candidate.symbol
                                                ? "核查中"
                                                : qualificationTargetSymbol == candidate.symbol && (qualificationError != nil || qualification?.status != .available)
                                                    ? "重新核查"
                                                    : "轻量候选核查",
                                            systemImage: "checkmark.magnifyingglass"
                                        )
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(isQualifying || isOpeningQualifiedCandidate || isContinuingAnnouncement)
                                    .accessibilityIdentifier("marketDiscoveryQualify-\(candidate.symbol)")
                                }
                            }
                            if qualification?.symbol == candidate.symbol, let qualification {
                                qualificationContent(qualification)
                            } else if qualificationTargetSymbol == candidate.symbol, let qualificationError {
                                Text(qualificationError)
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                    .accessibilityIdentifier("marketDiscoveryQualificationError")
                            }
                        }
                    }
                }
            }
            .padding(.top, 6)
        }
    }

    @ViewBuilder
    private func qualificationContent(_ result: MarketDiscoveryQualificationEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("候选轻量核查 · \(result.symbol)")
                .font(.headline)
            Text(result.message)
                .font(.caption)
                .foregroundStyle(result.status == .available ? Color.secondary : Color.orange)
            if result.status == .available {
                ForEach(result.facts) { fact in
                    Text("• \(fact.label)：\(fact.value) — \(fact.meaning)")
                        .font(.caption)
                }
                Text("尚未核实")
                    .font(.caption.weight(.semibold))
                ForEach(result.unknowns, id: \.self) { Text("• \($0)").font(.caption) }
                Text("下一步")
                    .font(.caption.weight(.semibold))
                ForEach(result.nextChecks, id: \.self) { Text("• \($0)").font(.caption) }
                Text("核查截止 \(result.binding?.candidateAsOf ?? "未记录")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let onOpenQualifiedCandidate {
                    Button {
                        guard !isOpeningQualifiedCandidate,
                              let binding = result.binding else { return }
                        let token = MarketDiscoveryContinuationToken(
                            generation: loadGeneration,
                            authorizationContext: AppEnvironment.researchAuthorizationContext(),
                            laneFetchedAt: binding.discoveryFetchedAt,
                            identityFingerprint: binding.candidateFingerprint
                        )
                        isOpeningQualifiedCandidate = true
                        Task {
                            defer { isOpeningQualifiedCandidate = false }
                            guard loadGeneration == token.generation,
                                  qualification == result else { return }
                            await onOpenQualifiedCandidate(result, token)
                        }
                    } label: {
                        Label(isOpeningQualifiedCandidate ? "正在打开" : qualifiedActionTitle, systemImage: "arrow.right.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isOpeningQualifiedCandidate)
                    .accessibilityIdentifier("marketDiscoveryOpenQualifiedResearch")
                }
            }
        }
        .padding(12)
        .background(Color(.tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketDiscoveryQualification")
    }

    @MainActor
    private func qualify(_ candidate: MarketDiscoveryCandidate, lane: CandidateDiscoveryLane) async {
        guard !isQualifying, let fetchedAt = lane.fetchedAt else { return }
        let context = AppEnvironment.researchAuthorizationContext()
        let generation = loadGeneration
        isQualifying = true
        qualificationTargetSymbol = candidate.symbol
        qualification = nil
        qualificationError = nil
        selectCandidate(candidate.symbol)
        defer { isQualifying = false }
        do {
            let result = try await MarketQuoteClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            ).qualifyDiscoveryCandidate(candidate, discoveryFetchedAt: fetchedAt)
            guard loadGeneration == generation,
                  AppEnvironment.researchAuthorizationContext() == context,
                  envelope?.candidates.fetchedAt == fetchedAt,
                  envelope?.candidates.candidates.contains(candidate) == true,
                  result.binding?.discoveryFetchedAt == fetchedAt, result.binding?.candidateAsOf == candidate.asOf else { return }
            qualification = result
        } catch {
            guard AppEnvironment.researchAuthorizationContext() == context else { return }
            qualification = nil
            qualificationError = "轻量核查失败；没有展示旧结果，请刷新候选后重试。"
        }
    }

    @ViewBuilder
    private func announcementContent(_ lane: OfficialAnnouncementDiscoveryLane) -> some View {
        let visibleItems = lane.items.filter { $0.id != excludedAnnouncementId }
        DisclosureGroup("\(noticeSymbol) HKEX 官方公告 · \(visibleItems.count)") {
            VStack(alignment: .leading, spacing: 10) {
                if lane.status == .unavailable {
                    Text("HKEXnews 官方公告暂不可用；没有展示旧公告。")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else {
                    ForEach(visibleItems) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(item.publishedDate) · \(announcementCategory(item.category))")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(item.title)
                                .font(.callout.weight(.semibold))
                            Text(item.why)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("官网只提供发布日期；导入会把日期起点作为存储锚点，不代表实际发布时间。")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            HStack {
                                if let url = item.url {
                                    Link("打开官方 PDF", destination: url)
                                        .buttonStyle(.bordered)
                                }
                                if let onImportAnnouncement {
                                    Button("确认并导入研究") {
                                        guard !isContinuingAnnouncement,
                                              let fetchedAt = lane.fetchedAt else { return }
                                        let token = MarketDiscoveryContinuationToken(
                                            generation: loadGeneration,
                                            authorizationContext: AppEnvironment.researchAuthorizationContext(),
                                            laneFetchedAt: fetchedAt,
                                            identityFingerprint: item.id
                                        )
                                        isContinuingAnnouncement = true
                                        Task {
                                            defer { isContinuingAnnouncement = false }
                                            guard loadGeneration == token.generation,
                                                  envelope?.announcements.items.contains(item) == true else { return }
                                            await onImportAnnouncement(item, token)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(isContinuingAnnouncement || isOpeningQualifiedCandidate || isQualifying)
                                } else {
                                    Button("去市场核验并导入") {
                                        if let onOpenAnnouncement {
                                            onOpenAnnouncement(item)
                                        } else {
                                            selectCandidate(item.symbol)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("marketDiscoveryAnnouncement-\(item.id)")
                    }
                }
            }
            .padding(.top, 6)
        }
    }

    @MainActor
    private func load() async {
        guard !isOpeningQualifiedCandidate, !isContinuingAnnouncement else { return }
        let ticket = UUID()
        loadGeneration = ticket
        onDiscoveryGenerationChanged?(ticket)
        isLoading = true
        envelope = nil
        qualification = nil
        qualificationTargetSymbol = nil
        qualificationError = nil
        defer {
            if ticket == loadGeneration { isLoading = false }
        }
        let context = AppEnvironment.researchAuthorizationContext()
        do {
            let fetched = try await MarketQuoteClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            ).fetchDailyDiscovery(noticeSymbol: noticeSymbol)
            guard ticket == loadGeneration,
                  !Task.isCancelled,
                  AppEnvironment.researchAuthorizationContext() == context else { return }
            envelope = fetched
        } catch {
            guard ticket == loadGeneration,
                  !Task.isCancelled,
                  AppEnvironment.researchAuthorizationContext() == context else { return }
            envelope = nil
        }
    }

    private func selectCandidate(_ symbol: String) {
        if qualificationTargetSymbol != symbol {
            qualification = nil
            qualificationTargetSymbol = nil
            qualificationError = nil
        }
        onSelectCandidate(symbol)
    }
}

private func marketDiscoveryCompact(_ value: Double) -> String {
    if value >= 1_000_000_000 { return String(format: "%.1f亿港元", value / 100_000_000) }
    if value >= 10_000 { return String(format: "%.1f万港元", value / 10_000) }
    return String(format: "%.0f港元", value)
}
