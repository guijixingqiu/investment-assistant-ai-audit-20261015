import SwiftUI

extension GateAMarketScreen {

    @MainActor
    func openQualifiedCandidate(
        _ qualification: MarketDiscoveryQualificationEnvelope,
        continuation: MarketDiscoveryContinuationToken
    ) async {
        guard qualification.status == .available,
              let binding = qualification.binding,
              binding.discoveryFetchedAt == continuation.laneFetchedAt,
              binding.candidateFingerprint == continuation.identityFingerprint,
              marketDiscoveryContinuationIsCurrent(continuation),
              let qualified = SecuritySymbol.parseHongKongAlias(qualification.symbol),
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == qualified.canonical else {
            membershipWriteMessage = "候选标的已变化；请重新执行轻量核查。"
            return
        }
        guard let admission = await refreshMarketResearchAdmission(),
              marketResearchAdmissionIsCurrent(admission),
              admission.symbol == qualified.canonical else { return }
        await continueToResearch(qualified, admission: admission, continuation: continuation)
    }

    @MainActor
    func addCandidateAndOpenResearch(
        admission: MarketResearchAdmissionToken,
        continuation: MarketDiscoveryContinuationToken? = nil
    ) async {
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput),
              symbol.canonical == admission.symbol,
              marketResearchAdmissionIsCurrent(admission),
              marketDiscoveryContinuationIsCurrent(continuation),
              candidateMemberships.status != .unavailable,
              !membershipSubmissionState.isInFlight else { return }
        let fingerprint = CandidateMembershipSubmissionFingerprint(
            operation: "create",
            membershipId: nil,
            code: symbol.code,
            currentVersion: nil,
            targetState: .tracked,
            restoreArchived: true
        )
        guard let submission = membershipSubmissionState.begin(fingerprint: fingerprint) else { return }
        let context = AppEnvironment.researchAuthorizationContext()
        let requestId = UUID()
        membershipRequestId = requestId
        membershipWriteMessage = "正在写入研究自选；不会创建订单或修改资产事实。"
        let client = ResearchClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName,
            writeAuthToken: context.writeToken,
            writeAuthHeaderName: context.writeHeaderName
        )
        do {
            let response = try await client.createCandidateMembership(
                request: CreateCandidateMembershipRequest(
                    market: symbol.market,
                    code: symbol.code,
                    initialState: .tracked,
                    restoreArchived: true,
                    idempotencyKey: submission.idempotencyKey
                )
            )
            guard membershipRequestId == requestId else { return }
            guard AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
                  marketResearchAdmissionIsCurrent(admission),
                  marketDiscoveryContinuationIsCurrent(continuation) else {
                membershipSubmissionState.finishFailurePreservingRetry()
                membershipWriteMessage = "标的、授权或市场事实已变化；未打开研究，保留同一请求身份供核对。"
                Task { await loadMarketScreen() }
                return
            }
            guard response.data.market == symbol.market,
                  response.data.code == symbol.code,
                  response.data.symbol == symbol.canonical,
                  response.data.state != .archived else {
                membershipSubmissionState.finishFailurePreservingRetry()
                membershipWriteMessage = "写入响应与当前标的不一致；未打开研究，保留同一请求身份供重试。"
                return
            }
            let expectedTarget = TodayCandidateNavigationTarget(membershipId: response.data.id, membershipVersion: response.data.version, symbol: response.data.symbol)
            guard await loadCandidateOverview() else {
                guard membershipRequestId == requestId else { return }
                membershipSubmissionState.finishFailurePreservingRetry()
                membershipWriteMessage = "写入后成员读取被更新请求取代；未打开研究，保留同一请求身份供核对。"
                return
            }
            guard membershipRequestId == requestId else { return }
            guard marketResearchAdmissionIsCurrent(admission),
                  AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical,
                  marketDiscoveryContinuationIsCurrent(continuation) else {
                membershipSubmissionState.finishFailurePreservingRetry()
                membershipWriteMessage = "写入后上下文已变化；未打开研究，保留同一请求身份供核对。"
                Task { await loadMarketScreen() }
                return
            }
            guard candidateResearchNavigationTarget(for: symbol.canonical, in: candidateMemberships) == expectedTarget else {
                membershipSubmissionState.finishFailurePreservingRetry()
                membershipWriteMessage = "写入后未读取到同一研究成员；未打开研究，保留同一请求身份供重试。"
                return
            }
            membershipSubmissionState.finishSuccessOrReplay()
            todayRefreshRevision &+= 1
            openResearchCandidate(expectedTarget)
        } catch {
            guard membershipRequestId == requestId else { return }
            membershipSubmissionState.finishFailurePreservingRetry()
            guard AppEnvironment.researchAuthorizationContext() == context,
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else {
                membershipWriteMessage = "写入结果未知且上下文已变化；保留同一请求身份，返回原标的后可安全重试。"
                Task { await loadMarketScreen() }
                return
            }
            membershipWriteMessage = candidateMembershipWriteFailurePresentation(
                for: error,
                operation: .create
            ).message
        }
    }

    @MainActor
    func resetCandidateMembershipWrite() {
        guard !membershipSubmissionState.isInFlight else {
            membershipWriteMessage = "研究成员写入仍在核对；完成前不会发起第二次写入。"
            return
        }
        membershipRequestId = UUID()
        membershipSubmissionState = CandidateMembershipSubmissionState()
        membershipWriteMessage = nil
    }

    @MainActor
    func openOrAddCurrentResearch(expectedOpenTarget: TodayCandidateNavigationTarget?) async {
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else { return }
        guard expectedOpenTarget?.symbol == symbol.canonical || expectedOpenTarget == nil else { return }
        if let issue = currentMarketResearchAdmissionIssue {
            membershipWriteMessage = issue
            return
        }
        guard let admission = await refreshMarketResearchAdmission() else { return }
        await continueToResearch(symbol, admission: admission, expectedOpenTarget: expectedOpenTarget)
    }

    @MainActor
    func continueToResearch(
        _ symbol: SecuritySymbol,
        admission: MarketResearchAdmissionToken,
        expectedOpenTarget: TodayCandidateNavigationTarget? = nil,
        continuation: MarketDiscoveryContinuationToken? = nil
    ) async {
        let requestId = UUID()
        let context = admission.authorizationContext
        candidateNavigationRequestId = requestId
        guard candidateNavigationRequestId == requestId,
              marketResearchAdmissionIsCurrent(admission),
              marketDiscoveryContinuationIsCurrent(continuation),
              admission.symbol == symbol.canonical,
              admission.authorizationContext == context else { return }
        membershipWriteMessage = "市场事实已核对；正在重新读取精确研究成员。"
        guard await loadCandidateOverview() else {
            guard candidateNavigationRequestId == requestId else { return }
            membershipWriteMessage = "研究成员读取被更新请求取代；未使用旧成员打开或写入研究。"
            return
        }
        guard candidateNavigationRequestId == requestId,
              marketResearchAdmissionIsCurrent(admission),
              marketDiscoveryContinuationIsCurrent(continuation),
              AppEnvironment.researchAuthorizationContext() == context,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
        let freshTarget = candidateResearchNavigationTarget(for: symbol.canonical, in: candidateMemberships)
        if let expectedOpenTarget {
            guard freshTarget == expectedOpenTarget else {
                membershipWriteMessage = "研究成员已变化；未把打开研究动作改成成员写入。请重新读取后再操作。"
                return
            }
            openResearchCandidate(expectedOpenTarget)
            return
        }
        if let target = freshTarget {
            openResearchCandidate(target)
            return
        }
        guard candidateMemberships.status != .unavailable else {
            membershipWriteMessage = "研究成员来源不可用；未加入或打开可能错绑的研究。"
            return
        }
        let matches = candidateMemberships.memberships.filter {
            $0.symbol == symbol.canonical && $0.state != .archived
        }
        guard matches.isEmpty else {
            membershipWriteMessage = "研究成员身份冲突；未加入或打开可能错绑的研究。"
            return
        }
        await addCandidateAndOpenResearch(admission: admission, continuation: continuation)
    }

    func marketCandidateOverview() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("已有研究候选")
                .font(.headline)
                .accessibilityIdentifier("marketCandidateOverviewTitle")
            Text("来自已有研究档案，按研究维护信息展示，不是推荐或排名。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(marketCandidateOverviewStatus)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("marketCandidateOverviewStatus")
            if candidateOverview.status == .unavailable && candidateMemberships.status != .unavailable {
                Button("重新读取候选") {
                    Task { await loadCandidateOverview() }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("marketCandidateOverviewRetry")
            }

            if candidateMemberships.status == .available {
                Text("研究自选") .font(.callout.weight(.semibold))
                ForEach(candidateMemberships.memberships) { membership in
                    Button {
                        symbolInput = membership.symbol
                        Task { await openExistingResearch(membership.symbol) }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(membership.research.name.map { "\(membership.symbol) · \($0)" } ?? membership.symbol) .font(.callout.weight(.semibold))
                            Text("\(membership.state.marketLabel) · 研究\(membership.research.status.marketLabel) · 行情\(membership.quote.status.marketLabel)") .font(.caption) .foregroundStyle(.secondary)
                        } .frame(maxWidth: .infinity, alignment: .leading)
                    } .buttonStyle(.bordered) .accessibilityIdentifier("marketOpenMembership-\(membership.symbol)")
                        .disabled(membershipSubmissionState.isInFlight || isRefreshingDaily || isRefreshingMarketResearchAdmission)
                }
            } else if candidateMemberships.status == .unavailable {
                Text("研究自选暂不可用；未展示旧成员。") .font(.caption) .foregroundStyle(.orange)
                Button("重新读取研究自选") {
                    Task { await loadCandidateOverview() }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("marketCandidateMembershipRetry")
            }

            if candidateOverview.candidates.isEmpty {
                Text(candidateOverview.status == .empty ? "暂无已有研究候选。" : "候选列表不可用，未展示旧数据或部分数据。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("marketCandidateOverviewEmpty")
            } else {
                ForEach(candidateOverview.candidates) { candidate in
                    Button {
                        symbolInput = candidate.symbol
                        Task { await openExistingResearch(candidate.symbol) }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(candidate.name.map { "\(candidate.symbol) · \($0)" } ?? candidate.symbol)
                                .font(.callout.weight(.semibold))
                            Text("证据 \(candidate.evidenceCount) · 待处理 \(candidate.pendingSuggestionCount) · 行情\(candidate.quote.status.marketLabel)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                    .disabled(membershipSubmissionState.isInFlight || isRefreshingDaily || isRefreshingMarketResearchAdmission)
                    .accessibilityIdentifier("marketOpenCandidate-\(candidate.symbol)")
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("marketCandidateOverview")
    }

    private var marketCandidateOverviewStatus: String {
        switch candidateOverview.status {
        case .available: "已读取 \(candidateOverview.candidates.count) 个已有研究候选。"
        case .empty: "暂无已有研究候选。"
        case .unavailable: "候选列表暂不可用；未显示旧数据。"
        }
    }

    @MainActor
    func openExistingResearch(_ rawSymbol: String) async {
        guard let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol) else { return }
        let requestId = UUID()
        candidateNavigationRequestId = requestId
        let context = AppEnvironment.researchAuthorizationContext()
        guard let admission = await refreshMarketResearchAdmission(),
              candidateNavigationRequestId == requestId,
              marketResearchAdmissionIsCurrent(admission),
              admission.symbol == symbol.canonical,
              admission.authorizationContext == context else { return }
        membershipWriteMessage = "市场事实已核对；正在确认精确研究成员。"
        let memberships = await ResearchClient(
            baseURL: context.baseURL,
            authToken: context.readToken,
            authHeaderName: context.readHeaderName
        ).fetchCandidateMemberships(includeArchived: false)
        guard candidateNavigationRequestId == requestId,
              marketResearchAdmissionIsCurrent(admission),
              AppEnvironment.researchAuthorizationContext() == context,
              SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
        if let target = candidateResearchNavigationTarget(for: symbol.canonical, in: memberships) {
            openResearchCandidate(target)
        } else {
            membershipWriteMessage = memberships.status == .unavailable
                ? "研究成员来源不可用；未打开可能错绑的研究。"
                : "活动研究成员已变化；请重新读取后再打开研究。"
        }
    }

    @MainActor
    func marketDiscoveryContinuationIsCurrent(_ continuation: MarketDiscoveryContinuationToken?) -> Bool {
        guard let continuation else { return true }
        return marketDiscoveryGeneration == continuation.generation
            && AppEnvironment.researchAuthorizationContext() == continuation.authorizationContext
    }
}

private extension CandidateMembershipState {
    var marketLabel: String {
        switch self {
        case .tracked: "跟踪中"
        case .paused: "已暂停"
        case .archived: "已归档"
        }
    }
}

private extension CandidateMembershipResearchStatus {
    var marketLabel: String {
        switch self {
        case .available: "已有档案"
        case .missing: "待建立档案"
        }
    }
}

private extension CandidateMembershipQuoteStatus {
    var marketLabel: String {
        switch self {
        case .fresh: "新鲜"
        case .stale: "非实时"
        case .unavailable: "暂不可用"
        }
    }
}

private extension CandidateOverviewQuoteStatus {
    var marketLabel: String {
        switch self {
        case .fresh: "新鲜"
        case .stale: "非实时"
        case .unavailable: "暂不可用"
        }
    }
}

extension MarketQuoteEnvelope {
    static func unavailable(_ message: String, requestedSymbol: String = "UNSELECTED") -> MarketQuoteEnvelope {
        MarketQuoteEnvelope(
            schemaVersion: "2026-06-17.gate-a.v1",
            status: .unavailable,
            asOf: nil,
            requestedSymbol: requestedSymbol,
            source: MarketQuoteSource(provider: .unavailable, providerStatus: .unavailable, fetchedAt: nil),
            data: nil,
            message: message
        )
    }
}
