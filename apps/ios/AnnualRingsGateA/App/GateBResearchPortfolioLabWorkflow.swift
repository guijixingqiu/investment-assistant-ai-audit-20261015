import Foundation

extension GateBResearchScreen {
    var parsedPortfolioLabAmounts: [Double]? {
        let fields = portfolioLabAmountsInput.split(separator: ",", omittingEmptySubsequences: false)
        guard (1...4).contains(fields.count) else { return nil }
        var amounts: [Double] = []
        for field in fields {
            let value = String(field).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, let amount = Double(value), amount.isFinite,
                  amount >= 0, amount <= 1_000_000_000_000 else { return nil }
            amounts.append(amount)
        }
        return amounts
    }

    var canLoadAnnualPortfolioLab: Bool {
        selectedMembership?.state != .archived
            && selectedMembership?.symbol == parsedSymbol?.canonical
            && parsedPortfolioLabAmounts != nil
            && !isLoadingPortfolioContext
            && !isLoadingPortfolioRisk
            && !isLoadingPortfolioLab
            && !isLoadingPortfolioReportExplanation
            && !isPortfolioLabBlockedByCurrentContext
    }

    var annualPortfolioLabNeedsQuoteRefresh: Bool {
        portfolioLabEnvelope.data == nil
            && portfolioLabEnvelope.clientFailureState == "conflict"
            && portfolioLabEnvelope.message == "A fresh candidate-bound Futu quote is required before portfolio scenarios are visible."
    }

    var canRefreshAnnualPortfolioLabQuote: Bool {
        guard let membership = selectedMembership else { return false }
        return annualPortfolioLabNeedsQuoteRefresh
            && membership.state != .archived
            && membership.symbol == parsedSymbol?.canonical
            && parsedPortfolioLabAmounts != nil
            && !isLoadingPortfolioContext
            && !isLoadingPortfolioRisk
            && !isLoadingPortfolioLab
            && !isLoadingPortfolioReportExplanation
    }

    var canLoadPortfolioReportExplanation: Bool {
        selectedMembership?.state != .archived
            && selectedMembership?.symbol == parsedSymbol?.canonical
            && parsedPortfolioLabAmounts != nil
            && hasExplicitPortfolioReportExplanationAmount
            && !isLoadingPortfolioLab
            && !isLoadingPortfolioReportExplanation
    }

    var canLoadComparedAnnualPortfolioLab: Bool {
        guard let current = selectedMembership,
              portfolioLabEnvelope.data?.target.membershipId == current.id,
              let targetId = comparedPortfolioLabMembershipId else { return false }
        return parsedPortfolioLabAmounts != nil
            && !isLoadingPortfolioLab
            && !isLoadingComparedPortfolioLab
            && candidateMemberships.memberships.contains {
                $0.id == targetId
                    && $0.actorId == current.actorId
                    && $0.symbol != current.symbol
                    && $0.state == .tracked
            }
    }

    private var isPortfolioLabBlockedByCurrentContext: Bool {
        guard let status = portfolioContext?.status ?? portfolioLabKnownContextStatus else { return false }
        return ![.available, .stale].contains(status)
    }

    var annualPortfolioLabReadiness: String {
        guard let membership = selectedMembership else { return "未选择当前研究自选" }
        guard membership.state != .archived else { return "当前研究自选已归档" }
        guard membership.symbol == parsedSymbol?.canonical else { return "研究自选与当前标的不一致" }
        guard parsedPortfolioLabAmounts != nil else { return "用户情景金额无效" }
        guard !isLoadingPortfolioContext, !isLoadingPortfolioRisk else { return "当前组合事实读取中" }
        guard !isLoadingPortfolioLab else { return "组合情景读取中" }
        guard !isPortfolioLabBlockedByCurrentContext else { return "当前组合状态不允许组合实验室计算" }
        return "可读取"
    }

    @MainActor
    func loadAnnualPortfolioLab() async {
        guard let membership = selectedMembership,
              membership.state != .archived,
              membership.symbol == parsedSymbol?.canonical,
              let amounts = parsedPortfolioLabAmounts else {
            clearAnnualPortfolioLab(
                message: "请选择当前未归档研究自选，并输入 1 至 4 个逗号分隔的非负港币金额。",
                membershipId: selectedMembership?.id,
                state: "malformed"
            )
            return
        }
        guard !isPortfolioLabBlockedByCurrentContext else {
            clearAnnualPortfolioLab(
                message: "当前组合状态不允许组合实验室计算；已保留现有组合事实。",
                membershipId: membership.id,
                state: "blocked"
            )
            return
        }
        guard !isLoadingPortfolioContext, !isLoadingPortfolioRisk else {
            clearAnnualPortfolioLab(message: "当前组合事实仍在读取；未发送组合实验室请求。", membershipId: membership.id, state: "blocked")
            return
        }
        clearPortfolioReportExplanation("组合实验室正在重新读取；旧报告组合解释已清除。")
        let request = AnnualPortfolioLabRequestGate(
            requestId: UUID(),
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            amounts: amounts
        )
        clearAnnualConditionalDecisionPreview("组合实验室正在重读；旧冻结预览已清除。", membershipId: membership.id)
        portfolioLabRequestId = request.requestId
        portfolioContextRequestId = UUID()
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioContext = false
        isLoadingPortfolioRisk = false
        isLoadingPortfolioLab = true
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        portfolioLabEnvelope = .unavailable("正在读取账户绑定组合实验室...", membershipId: membership.id, clientFailureState: "loading")
        portfolioLabMessage = "正在绑定候选版本、Pingan 快照、Futu 报价和用户情景顺序。"
        clearComparedAnnualPortfolioLab("当前股票组合风险正在重新读取；旧跨股票比较已清除。")

        let envelope = await portfolioLabClient.fetchPortfolioLab(
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            scenarioAmounts: amounts
        )
        let disposition = request.disposition(
            currentRequestId: portfolioLabRequestId,
            membershipId: selectedMembership?.id,
            membershipVersion: selectedMembership?.version,
            symbol: selectedMembership?.symbol == parsedSymbol?.canonical ? selectedMembership?.symbol : nil,
            amounts: parsedPortfolioLabAmounts
        )
        guard disposition != .staleRequest else { return }
        isLoadingPortfolioLab = false
        guard disposition == .current else {
            clearAnnualPortfolioLab(
                message: "候选、版本、标的或用户情景已变化；旧组合实验室响应已丢弃。",
                membershipId: membership.id,
                state: "superseded"
            )
            return
        }
        guard envelope.status == "available", let data = envelope.data,
              data.target.membershipId == membership.id,
              data.target.membershipVersion == membership.version,
              data.target.symbol == membership.symbol else {
            portfolioContext = nil
            portfolioLabKnownContextStatus = nil
            portfolioRiskImpact = nil
            portfolioLabEnvelope = envelope
            portfolioLabMessage = annualPortfolioLabNeedsQuoteRefresh
                ? "当前候选报价已超过 freshness 窗口；请明确刷新报价后再重试，系统不会自动触发 provider 写入。"
                : envelope.message
            return
        }
        portfolioContext = data.portfolio
        portfolioLabKnownContextStatus = data.portfolio.status
        portfolioContextMessage = data.portfolio.message
        portfolioRiskImpact = nil
        portfolioRiskMessage = "多个用户情景不会自动成为决策快照中的单一风险情景；需要时仍可单独复算一个中性金额。"
        portfolioLabEnvelope = envelope
        portfolioLabMessage = envelope.message
    }

    @MainActor
    func loadComparedAnnualPortfolioLab() async {
        guard let current = selectedMembership,
              let currentData = portfolioLabEnvelope.data,
              currentData.target.membershipId == current.id,
              currentData.target.membershipVersion == current.version,
              currentData.target.symbol == current.symbol,
              let amounts = parsedPortfolioLabAmounts,
              let targetId = comparedPortfolioLabMembershipId,
              let target = candidateMemberships.memberships.first(where: {
                  $0.id == targetId
                      && $0.actorId == current.actorId
                      && $0.symbol != current.symbol
                      && $0.state == .tracked
              }) else {
            clearComparedAnnualPortfolioLab("请先读取当前股票组合风险，再选择另一只已跟踪股票。")
            return
        }
        let requestId = UUID()
        let authorizationRevision = viewModel.authorizationRevision
        let currentIdentity = ResearchDocumentOperationIdentity(membership: current)
        let targetIdentity = ResearchDocumentOperationIdentity(membership: target)
        comparedPortfolioLabRequestId = requestId
        isLoadingComparedPortfolioLab = true
        comparedPortfolioLabEnvelope = nil
        comparedPortfolioLabMessage = "正在读取 \(target.symbol) 的同金额组合风险…"
        defer {
            if comparedPortfolioLabRequestId == requestId {
                isLoadingComparedPortfolioLab = false
            }
        }

        let envelope = await portfolioLabClient.fetchPortfolioLab(
            membershipId: target.id,
            membershipVersion: target.version,
            symbol: target.symbol,
            scenarioAmounts: amounts
        )
        guard comparedPortfolioLabRequestId == requestId,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              currentIdentity.matches(membership: selectedMembership),
              parsedPortfolioLabAmounts == amounts,
              candidateMemberships.memberships.contains(where: {
                  targetIdentity.matches(membership: $0) && $0.state == .tracked
              }),
              portfolioLabEnvelope.data?.target.membershipId == current.id else { return }
        guard envelope.status == "available", let compared = envelope.data,
              compared.target.membershipId == target.id,
              compared.target.membershipVersion == target.version,
              compared.target.symbol == target.symbol else {
            comparedPortfolioLabEnvelope = nil
            comparedPortfolioLabMessage = envelope.message
            return
        }
        guard currentData.sourceIdentity.accountScopeId == compared.sourceIdentity.accountScopeId,
              currentData.sourceIdentity.portfolioSnapshotId == compared.sourceIdentity.portfolioSnapshotId,
              currentData.sourceIdentity.portfolioAsOf == compared.sourceIdentity.portfolioAsOf else {
            comparedPortfolioLabEnvelope = nil
            comparedPortfolioLabMessage = "两只股票读取期间组合快照已变化；请重新读取当前股票后再比较。"
            return
        }
        comparedPortfolioLabEnvelope = envelope
        comparedPortfolioLabMessage = "已基于同一 Pingan 组合快照比较 \(current.symbol) 与 \(target.symbol)。"
    }

    @MainActor
    func clearComparedAnnualPortfolioLab(_ message: String) {
        comparedPortfolioLabRequestId = UUID()
        isLoadingComparedPortfolioLab = false
        comparedPortfolioLabEnvelope = nil
        comparedPortfolioLabMessage = message
    }

    @MainActor
    func refreshAnnualPortfolioLabQuoteAndRetry() async {
        guard canRefreshAnnualPortfolioLabQuote,
              let membership = selectedMembership,
              let symbol = SecuritySymbol.parseHongKongAlias(membership.symbol),
              let amounts = parsedPortfolioLabAmounts else { return }
        let request = AnnualPortfolioLabRequestGate(
            requestId: UUID(),
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            amounts: amounts
        )
        let context = AppEnvironment.researchAuthorizationContext()
        let authorizationRevision = viewModel.authorizationRevision
        portfolioLabRequestId = request.requestId
        isLoadingPortfolioLab = true
        portfolioLabMessage = "正在按 Owner 明确操作刷新当前候选报价；不会自动刷新或写入组合事实。"
        defer {
            if portfolioLabRequestId == request.requestId { isLoadingPortfolioLab = false }
        }
        do {
            let refreshed = try await MarketQuoteClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName,
                writeAuthToken: context.writeToken,
                writeAuthHeaderName: context.writeHeaderName
            ).refreshQuote(market: symbol.market, code: symbol.code)
            guard portfolioLabRequestId == request.requestId else { return }
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == context,
                  request.disposition(
                    currentRequestId: portfolioLabRequestId,
                    membershipId: selectedMembership?.id,
                    membershipVersion: selectedMembership?.version,
                    symbol: selectedMembership?.symbol == parsedSymbol?.canonical ? selectedMembership?.symbol : nil,
                    amounts: parsedPortfolioLabAmounts
                  ) == .current else {
                clearAnnualPortfolioLab(
                    message: "membership、标的、授权或用户情景已变化；已停止刷新和重试。",
                    membershipId: membership.id,
                    state: "superseded"
                )
                return
            }
            guard refreshed.status == .live,
                  refreshed.source.provider == .futu,
                  refreshed.data?.symbol == membership.symbol else {
                clearAnnualPortfolioLab(
                    message: "已刷新报价，但当前市场未提供 fresh live 行情；组合实验室继续保持不可用。",
                    membershipId: membership.id,
                    state: "stale"
                )
                return
            }
            isLoadingPortfolioLab = false
            await loadAnnualPortfolioLab()
        } catch {
            guard portfolioLabRequestId == request.requestId else { return }
            clearAnnualPortfolioLab(
                message: "当前候选报价刷新失败；组合实验室未重试，旧结果已清除。",
                membershipId: membership.id,
                state: "unavailable"
            )
        }
    }

    @MainActor
    func loadPortfolioReportExplanation() async {
        guard let membership = selectedMembership,
              membership.state != .archived,
              membership.symbol == parsedSymbol?.canonical,
              let amounts = parsedPortfolioLabAmounts else {
            clearPortfolioReportExplanation("请选择当前未归档研究自选，并输入 1 至 4 个非负港币金额。")
            return
        }
        let request = AnnualPortfolioLabRequestGate(
            requestId: UUID(),
            membershipId: membership.id,
            membershipVersion: membership.version,
            symbol: membership.symbol,
            amounts: amounts
        )
        let authorizationRevision = viewModel.authorizationRevision
        clearPortfolioReportExplanation("正在重新读取当前报告、证据包、组合与用户情景。")
        portfolioReportExplanationRequestId = request.requestId
        isLoadingPortfolioReportExplanation = true
        do {
            let envelope = try await client.fetchPortfolioReportExplanation(
                membershipId: membership.id,
                membershipVersion: membership.version,
                membershipState: membership.state,
                actorId: membership.actorId,
                symbol: membership.symbol,
                scenarioAmounts: amounts
            )
            guard portfolioReportExplanationRequestId == request.requestId else { return }
            isLoadingPortfolioReportExplanation = false
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  request.disposition(
                    currentRequestId: portfolioReportExplanationRequestId,
                    membershipId: selectedMembership?.id,
                    membershipVersion: selectedMembership?.version,
                    symbol: selectedMembership?.symbol == parsedSymbol?.canonical ? selectedMembership?.symbol : nil,
                    amounts: parsedPortfolioLabAmounts
                  ) == .current,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.actorId == membership.actorId else {
                clearPortfolioReportExplanation("membership、标的、授权或用户金额已变化；旧报告组合解释已清除。")
                return
            }
            guard envelope.status == .available, let data = envelope.data,
                  data.binding.membershipId == membership.id,
                  data.binding.membershipVersion == membership.version,
                  data.binding.membershipState == membership.state,
                  envelope.requestedActorId == membership.actorId,
                  data.binding.symbol == membership.symbol,
                  data.scenarios.map(\.userInputAmount) == amounts else {
                clearPortfolioReportExplanation(envelope.status == .blocked ? envelope.message : portfolioReportExplanationFailureMessage(envelope.status))
                return
            }
            portfolioReportExplanation = envelope
            portfolioReportExplanationMessage = "已重新读取当前报告的只读组合影响；情景顺序与用户输入一致。"
        } catch {
            guard portfolioReportExplanationRequestId == request.requestId else { return }
            isLoadingPortfolioReportExplanation = false
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  request.disposition(
                    currentRequestId: portfolioReportExplanationRequestId,
                    membershipId: selectedMembership?.id,
                    membershipVersion: selectedMembership?.version,
                    symbol: selectedMembership?.symbol == parsedSymbol?.canonical ? selectedMembership?.symbol : nil,
                    amounts: parsedPortfolioLabAmounts
                  ) == .current,
                  selectedMembership?.state == membership.state,
                  selectedMembership?.actorId == membership.actorId else {
                clearPortfolioReportExplanation("membership、标的、授权或用户金额已变化；旧报告组合解释已清除。")
                return
            }
            clearPortfolioReportExplanation(portfolioReportExplanationFailureMessage(error))
        }
    }

    @MainActor
    func clearPortfolioReportExplanation(_ message: String) {
        portfolioReportExplanationRequestId = UUID()
        isLoadingPortfolioReportExplanation = false
        portfolioReportExplanation = nil
        portfolioReportExplanationMessage = message
    }

    @MainActor
    func clearAnnualPortfolioLab(
        message: String,
        membershipId: String?,
        state: String = "unavailable"
    ) {
        clearComparedAnnualPortfolioLab(message)
        clearAnnualConditionalDecisionPreview(message, membershipId: membershipId)
        clearPortfolioReportExplanation(message)
        hasExplicitPortfolioReportExplanationAmount = false
        portfolioLabRequestId = UUID()
        isLoadingPortfolioLab = false
        portfolioLabEnvelope = .unavailable(message, membershipId: membershipId ?? "unselected", clientFailureState: state)
        portfolioLabMessage = message
    }

    private func portfolioReportExplanationFailureMessage(
        _ status: PortfolioReportExplanationStatus
    ) -> String {
        switch status {
        case .unauthorized: "未认证：报告组合解释已清除。"
        case .blocked: "当前报告、证据包或组合来源冲突；旧解释已清除。"
        case .malformed: "报告组合解释请求无效；旧解释已清除。"
        case .notFound: "当前研究自选或报告不存在；旧解释已清除。"
        case .unavailable: "报告组合解释暂不可用；旧解释已清除。"
        case .available: "报告组合解释缺少可验证数据；旧解释已清除。"
        }
    }

    private func portfolioReportExplanationFailureMessage(_ error: Error) -> String {
        switch error {
        case ResearchClientError.httpStatus(401), ResearchClientError.httpStatus(403):
            "未认证：报告组合解释已清除。"
        case ResearchClientError.httpStatus(409):
            "当前报告、证据包或组合来源冲突；旧解释已清除。"
        case ResearchClientError.httpStatus(503):
            "报告组合解释暂不可用；旧解释已清除。"
        case PortfolioReportExplanationValidationError.invalid, is DecodingError:
            "报告组合解释响应格式或语义无效；旧解释已清除。"
        case is URLError:
            "报告组合解释离线；旧解释已清除。"
        default:
            "报告组合解释不可用；旧解释已清除。"
        }
    }
}
