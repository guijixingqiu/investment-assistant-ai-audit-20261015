import SwiftUI
struct TodayReportConfirmationReservation: Equatable, Sendable {
    let itemId: String
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let actorId: String
    let reportId: String
    let reportVersion: Int
    let reportFingerprint: String
    let evidencePackId: String
    let evidencePackVersion: Int
    let evidencePackFingerprint: String
    let authorizationRevision: UUID
    init?(item: TodayResearchItem, membership: CandidateMembershipData, authorizationRevision: UUID) {
        guard item.trackingState == .awaitingUserConfirmation,
              item.symbol == membership.symbol,
              item.bindings.membershipId == membership.id,
              item.bindings.membershipVersion == membership.version,
              let report = item.bindings.reportRef,
              let pack = item.bindings.evidencePackRef,
              let revision = item.reportRevision?.current,
              revision.id == report.id,
              revision.version == report.version,
              revision.evidencePackId == report.evidencePackId,
              revision.reportFingerprint != "UNKNOWN",
              validFingerprint(revision.reportFingerprint) else { return nil }
        self.itemId = item.id
        membershipId = membership.id
        membershipVersion = membership.version
        symbol = membership.symbol
        actorId = membership.actorId
        reportId = report.id
        reportVersion = report.version
        reportFingerprint = revision.reportFingerprint
        evidencePackId = pack.id
        evidencePackVersion = pack.version
        evidencePackFingerprint = pack.packFingerprint
        self.authorizationRevision = authorizationRevision
    }
    func matches(report: TwoLayerReportData, evidencePack: FrozenResearchEvidencePack?, membership: CandidateMembershipData) -> Bool {
        membership.id == membershipId && membership.version == membershipVersion
            && membership.symbol == symbol && report.id == reportId && report.version == reportVersion
            && report.reportFingerprint == reportFingerprint && report.evidencePackId == evidencePackId
            && matches(evidencePack: evidencePack)
    }
    func matches(evidencePack: FrozenResearchEvidencePack?) -> Bool {
        evidencePack?.id == evidencePackId && evidencePack?.version == evidencePackVersion && evidencePack?.packFingerprint == evidencePackFingerprint
    }
}
func todayAwaitingConfirmationMatches(
    _ envelope: TodayResearchEnvelope,
    reservation: TodayReportConfirmationReservation
) -> Bool {
    guard envelope.status == .available,
          envelope.membershipId == reservation.membershipId,
          envelope.membershipVersion == reservation.membershipVersion,
          envelope.requestedSymbol == reservation.symbol,
          envelope.requestedActorId == reservation.actorId else { return false }
    let matches = envelope.items.filter { item in
        guard item.id == reservation.itemId,
              item.trackingState == .awaitingUserConfirmation,
              item.symbol == reservation.symbol,
              item.bindings.membershipId == reservation.membershipId,
              item.bindings.membershipVersion == reservation.membershipVersion,
              item.bindings.evidencePackRef?.id == reservation.evidencePackId,
              item.bindings.evidencePackRef?.version == reservation.evidencePackVersion,
              item.bindings.evidencePackRef?.packFingerprint == reservation.evidencePackFingerprint,
              item.bindings.reportRef?.id == reservation.reportId,
              item.bindings.reportRef?.version == reservation.reportVersion,
              item.bindings.reportRef?.evidencePackId == reservation.evidencePackId else { return false }
        return item.reportRevision?.current.id == reservation.reportId
            && item.reportRevision?.current.version == reservation.reportVersion
            && item.reportRevision?.current.reportFingerprint == reservation.reportFingerprint
    }
    return matches.count == 1
}
func todayConfirmationSuccess(
    _ envelope: TodayResearchEnvelope,
    reservation: TodayReportConfirmationReservation,
    decision: TwoLayerReportDecision
) -> Bool {
    guard envelope.status == .available,
          envelope.membershipId == reservation.membershipId,
          envelope.membershipVersion == reservation.membershipVersion,
          envelope.requestedSymbol == reservation.symbol,
          envelope.requestedActorId == reservation.actorId else { return false }
    let sameItem = envelope.items.filter { $0.id == reservation.itemId }
    guard sameItem.count <= 1,
          sameItem.first?.trackingState != .awaitingUserConfirmation else { return false }
    guard let item = sameItem.first else { return true }
    return item.trackingState == .confirmed
        && item.bindings.reportRef?.id == reservation.reportId
        && item.bindings.reportRef?.version == reservation.reportVersion
        && item.bindings.reportRef?.evidencePackId == reservation.evidencePackId
        && item.bindings.evidencePackRef?.id == reservation.evidencePackId
        && item.bindings.evidencePackRef?.version == reservation.evidencePackVersion
        && item.bindings.evidencePackRef?.packFingerprint == reservation.evidencePackFingerprint
        && item.reportRevision?.current.id == reservation.reportId
        && item.reportRevision?.current.version == reservation.reportVersion
        && item.reportRevision?.current.evidencePackId == reservation.evidencePackId
        && item.reportRevision?.current.reportFingerprint == reservation.reportFingerprint
        && item.bindings.decisionRef?.id == decision.id
        && item.bindings.decisionRef?.reportId == decision.reportId
        && item.bindings.decisionRef?.decision == "confirmed"
}
func todayFormalDecisionDueMatches(
    _ inbox: TodayActionInboxEnvelope,
    reservation: TodayReportConfirmationReservation,
    decision: TwoLayerReportDecision,
    actorId: String
) -> Bool {
    guard inbox.status == .available else { return false }
    let matches = inbox.items.filter { item in
        guard item.kind == .formalDecisionDue,
              item.state == .new,
              item.symbol == reservation.symbol,
              item.membership.id == reservation.membershipId,
              item.membership.version == reservation.membershipVersion,
              let event = item.reviewEvent,
              event.type == "FORMAL_DECISION_DUE",
              let binding = event.reportBinding else { return false }
        return binding.membershipId == reservation.membershipId
            && binding.membershipVersion == reservation.membershipVersion
            && binding.symbol == reservation.symbol
            && binding.evidencePackId == reservation.evidencePackId
            && binding.evidencePackFingerprint == reservation.evidencePackFingerprint
            && binding.reportId == reservation.reportId
            && binding.reportVersion == reservation.reportVersion
            && binding.reportFingerprint == reservation.reportFingerprint
            && binding.reportDecisionId == decision.id
            && binding.reportDecision == "confirmed"
            && binding.reportDecisionActorType == "user"
            && binding.reportDecisionActorId == actorId
            && event.sourceEventId == decision.id
            && event.stateReason == "confirmed_report_not_adopted"
    }
    return matches.count == 1
}
struct TodayResearchReportNavigationTarget: Equatable, Hashable {
    let id: String
    let version: Int
    let evidencePackId: String
}
struct TodayResearchSourceNavigationTarget: Equatable, Hashable {
    let lane: String
    let id: String
    let version: Int?
    let sourceType: String
    let sourceFingerprint: String?
    init(source: TodayActionInboxSourceRef) {
        lane = source.lane
        id = source.id
        version = source.version
        sourceType = source.sourceType
        sourceFingerprint = source.sourceFingerprint
    }
    init(item: TodayResearchItem) {
        let fact = item.bindings.factRefs.first
        if let monitor = item.bindings.monitorRef, monitor.kind == "weinstein_structure" { lane = "research"; id = item.id; version = monitor.runVersion; sourceType = "weinstein_technical_snapshot"; sourceFingerprint = monitor.runFingerprint; return }
        if item.trackingState == .rejected, let report = item.bindings.reportRef {
            let fingerprint = item.reportRevision?.current.reportFingerprint
            lane = "research"
            id = item.id
            version = report.version
            sourceType = "deep_research_reports"
            sourceFingerprint = fingerprint == "UNKNOWN" ? nil : fingerprint
            return
        }
        if [TodayResearchTrackingState.awaitingUserConfirmation, .confirmed].contains(item.trackingState), let report = item.bindings.reportRef {
            let fingerprint = item.reportRevision?.current.reportFingerprint
            lane = "research"
            id = report.id
            version = report.version
            sourceType = "deep_research_reports"
            sourceFingerprint = fingerprint == "UNKNOWN" ? nil : fingerprint
            return
        }
        if item.trackingState == .needsReview, item.category != .userAction,
           item.bindings.eventRefs.isEmpty == false || item.bindings.factRefs.isEmpty == false {
            lane = "research_material"
            id = item.bindings.eventRefs.first?.eventId ?? fact?.materialId ?? item.id
            version = item.bindings.eventRefs.first?.eventVersion ?? fact?.revision
            sourceType = fact?.sourceType ?? "research_events"
            sourceFingerprint = fact?.contentFingerprint
            return
        }
        lane = "research"
        id = item.id
        version = item.bindings.reportRef?.version ?? item.bindings.evidencePackRef?.version
        sourceType = fact?.sourceType ?? "today_research_projection"
        sourceFingerprint = fact?.contentFingerprint
    }

    func matches(_ item: TodayResearchItem) -> Bool {
        self == Self(item: item)
    }

    var displayLine: String {
        "\(TodayMaterialChangePresentation.sourceTypeLabel(sourceType)) · 记录 \(id) · \(version.map { "v\($0)" } ?? "版本未记录") · \(sourceFingerprint.map { "指纹 \($0)" } ?? "指纹未记录")"
    }
}
struct TodayResearchNavigationTarget: Equatable, Hashable {
    let requestId: UUID
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let itemId: String
    let preferredLayer: DailyDecisionRingLayer
    let report: TodayResearchReportNavigationTarget?
    let task: TodayActionInboxResearchTask?
    let source: TodayResearchSourceNavigationTarget

    var scrollAnchor: String { "todayResearchItem:\(itemId)" }
}
struct TodayResearchFeedCard: View {
    let symbol: String?
    let refreshRevision: UInt64
    let client: any TodayResearchFetching
    let openResearch: (TodayResearchNavigationTarget) -> Void
    @State private var envelope = TodayResearchEnvelope.unavailable(
        message: "尚未选择合法港股读取研究 Today。",
        membershipId: "unselected"
    )
    @State private var isLoading = false
    @State private var loadGate = TodayResearchFeedLoadGate()
    init(
        symbol: String?,
        refreshRevision: UInt64,
        client: any TodayResearchFetching = ResearchClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName()
        ),
        openResearch: @escaping (TodayResearchNavigationTarget) -> Void
    ) {
        self.symbol = symbol
        self.refreshRevision = refreshRevision
        self.client = client
        self.openResearch = openResearch
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("今日研究事项", systemImage: "doc.text.magnifyingglass")
                    .font(.headline)
                Spacer()
                Text(isLoading ? "读取中" : envelope.status.userLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(envelope.status == .available ? .green : .secondary)
                    .accessibilityIdentifier("todayResearchFeedStatus")
            }
            Text("系统生成的当前研究事项；打开研究页时仍会重新读取，不把这张卡片当成正式事件。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if envelope.status == .available {
                ForEach(Array(envelope.items.prefix(3))) { item in
                    itemCard(item)
                }
                if envelope.items.isEmpty {
                    Text("当前没有可展示的研究事项。")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("todayResearchFeedEmpty")
                } else if envelope.omittedItemCount > 0 {
                    Text("已按服务器固定优先级省略 \(envelope.omittedItemCount) 项较低优先事项。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(envelope.message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchFeedUnavailable")
                Button {
                    Task { await load() }
                } label: {
                    Label("重新读取今日研究事项", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(isLoading || symbol == nil)
                .accessibilityIdentifier("todayResearchFeedRetry")
            }
            Text("只读、研究证据边界；不自动形成建议、正式决定、订单、交易或资产事实。")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("todayResearchFeedNoEffects")
        }
        .cardStyle()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todayResearchFeedCard")
        .task(id: "\(symbol ?? "none"):\(refreshRevision)") {
            await load()
        }
    }

    @ViewBuilder
    private func itemCard(_ item: TodayResearchItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.title)
                    .font(.callout.weight(.semibold))
                Spacer()
                Text(item.trackingState.userLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(item.trackingState == .needsReview ? .orange : .secondary)
                    .accessibilityIdentifier("todayResearchFeedTrackingState-\(item.order)")
            }
            Text(item.summary)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            DisclosureGroup("来源详情") {
                Text("#\(item.order) · \(item.id)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("todayResearchFeedIdentity-\(item.order)")
                Text("来源身份：\(TodayResearchSourceNavigationTarget(item: item).displayLine)\(item.bindings.factRefs.first.map { " · 发布 \($0.publishedAt) · 采集 \($0.capturedAt)" } ?? "")")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchFeedSourceIdentity-\(item.order)")
                if let report = item.bindings.reportRef {
                    Text("报告 #\(report.id) v\(report.version) · 证据包 #\(report.evidencePackId)")
                        .font(.caption2.monospaced())
                        .accessibilityIdentifier("todayResearchFeedReport-\(item.order)")
                }
            }
            if let revision = item.reportRevision {
                Text(revision.previous.map { "版本 v\($0.version) → v\(revision.current.version)" } ?? "版本 v\(revision.current.version) · 首版")
                    .font(.caption.weight(.semibold))
                    .accessibilityIdentifier("todayResearchFeedReportRevision-\(item.order)")
                Text("版本说明：\(revision.declaredChange)")
                    .font(.caption)
                    .accessibilityIdentifier("todayResearchFeedReportDeclaredChange-\(item.order)")
                Text("变化：\(revision.bindingChanged == nil ? "尚未完成可比判断" : revision.changedSections.isEmpty ? "未检测到结构化字段变化" : revision.changedSections.joined(separator: "、"))")
                    .font(.caption)
                    .foregroundStyle(revision.changedSections.isEmpty ? Color.secondary : Color.orange)
                    .accessibilityIdentifier("todayResearchFeedReportChangedSections-\(item.order)")
                Text(revision.bindingChanged.map { $0 ? "证据来源：已变化" : "证据来源：未变化" } ?? (revision.previous == nil ? "首版，暂无上一版可比较" : "暂不可比较：历史报告格式不同，不能认定判断未变。"))
                    .font(.caption)
                    .foregroundStyle(revision.bindingChanged == true ? Color.orange : Color.secondary)
                    .accessibilityIdentifier("todayResearchFeedReportBinding-\(item.order)")
            }
            if let checkpoint = item.nextCheckpoint {
                Text("下一验证：\(checkpoint)")
                    .font(.caption)
                    .accessibilityIdentifier("todayResearchFeedQuestion-\(item.order)")
            }
            Button {
                openResearch(
                    TodayResearchNavigationTarget(
                        requestId: UUID(),
                        symbol: item.symbol,
                        membershipId: item.bindings.membershipId,
                        membershipVersion: item.bindings.membershipVersion,
                        itemId: item.id,
                        preferredLayer: item.category == .holdingLogicChange ? .portfolio : .evidence,
                        report: item.bindings.reportRef.map {
                            TodayResearchReportNavigationTarget(
                                id: $0.id,
                                version: $0.version,
                                evidencePackId: $0.evidencePackId
                            )
                        },
                        task: nil,
                        source: TodayResearchSourceNavigationTarget(item: item)
                    )
                )
            } label: {
                Label("打开对应研究并重新读取", systemImage: "arrow.right.circle")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("todayResearchFeedOpen-\(item.order)")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    @MainActor
    private func load() async {
        guard let symbol else {
            loadGate.invalidate()
            isLoading = false
            envelope = .unavailable(message: "尚未选择有效港股，无法读取今日研究事项。", membershipId: "unselected")
            return
        }
        let ticket = loadGate.begin(symbol: symbol)
        isLoading = true
        envelope = .unavailable(message: "正在读取 \(symbol) 的今日研究事项。", membershipId: "pending")
        let memberships = await client.fetchCandidateMemberships(includeArchived: false)
        guard loadGate.accepts(ticket, currentSymbol: self.symbol, isCancelled: Task.isCancelled) else { return }
        guard memberships.status == .available else {
            isLoading = false
            let status: TodayResearchStatus = memberships.status == .empty ? .notFound : .unavailable
            envelope = .unavailable(status, message: memberships.message, membershipId: memberships.status == .empty ? "empty" : "unavailable")
            return
        }
        guard let membership = uniqueActiveCandidateMembership(for: symbol, in: memberships) else {
            isLoading = false
            envelope = .unavailable(.notFound, message: "当前标的没有匹配的研究成员；未展示旧的今日事项。", membershipId: "unavailable")
            return
        }
        let loaded = await client.fetchTodayResearch(membershipId: membership.id)
        guard loadGate.accepts(ticket, currentSymbol: self.symbol, isCancelled: Task.isCancelled) else { return }
        let exposesIdentity = loaded.status == .available || loaded.status == .stale || loaded.status == .conflict
        if exposesIdentity,
           (loaded.membershipId != membership.id
            || loaded.requestedActorId != membership.actorId
            || (loaded.membershipVersion != nil && loaded.membershipVersion != membership.version)
            || (loaded.requestedSymbol != nil && loaded.requestedSymbol != symbol)) {
            isLoading = false
            envelope = .unavailable(.malformed, message: "今日事项的成员、版本或标的与当前来源不一致；已停止展示旧事项。", membershipId: membership.id)
            return
        }
        isLoading = false
        envelope = loaded
    }
}
