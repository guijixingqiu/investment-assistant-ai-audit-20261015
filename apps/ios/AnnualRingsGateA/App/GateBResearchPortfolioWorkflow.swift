import Foundation

extension GateBResearchScreen {
    var parsedPortfolioAmount: Double? {
        let value = portfolioAmountInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let amount = Double(value), amount.isFinite, amount >= 0 else {
            return nil
        }
        return amount
    }

    var canCalculatePortfolioRisk: Bool {
        portfolioContext?.status == .available
            && parsedSymbol != nil
            && parsedPortfolioAmount != nil
            && !isLoadingPortfolioContext
            && !isLoadingPortfolioRisk
    }

    @MainActor
    func loadPortfolioDecisionContext() async {
        let candidateSymbol = parsedSymbol?.canonical
        guard !isLoadingPortfolioContext || portfolioContextLoadingSymbol != candidateSymbol else { return }
        let requestId = UUID()
        portfolioContextRequestId = requestId
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioContext = true
        portfolioContextLoadingSymbol = candidateSymbol
        isLoadingPortfolioRisk = false
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        clearAnnualPortfolioLab(message: "当前组合正在刷新；旧组合实验室结果已清除。", membershipId: selectedMembership?.id)
        portfolioRiskMessage = nil
        portfolioContextMessage = "正在读取当前组合..."

        guard candidateSymbol != nil else {
            isLoadingPortfolioContext = false
            portfolioContextLoadingSymbol = nil
            portfolioContextMessage = "标的输入无效，未发送当前组合请求。"
            return
        }

        defer {
            if portfolioContextRequestId == requestId {
                isLoadingPortfolioContext = false
                portfolioContextLoadingSymbol = nil
            }
        }

        do {
            let fetched = try await portfolioClient.fetchContext()
            guard portfolioContextRequestId == requestId,
                  parsedSymbol?.canonical == candidateSymbol else { return }
            portfolioLabKnownContextStatus = fetched.status

            switch fetched.status {
            case .available:
                portfolioContext = fetched
                portfolioContextMessage = fetched.message
            case .stale, .partial, .zeroPosition:
                portfolioContext = fetched
                portfolioContextMessage = "\(fetched.message) 中性风险计算已关闭。"
            case .empty, .conflict, .unauthorized, .unavailable:
                portfolioContext = nil
                portfolioContextMessage = fetched.message
            }
        } catch {
            guard portfolioContextRequestId == requestId,
                  parsedSymbol?.canonical == candidateSymbol else { return }
            clearPortfolioContext(portfolioContextFailureMessage(error))
        }
    }

    @MainActor
    func calculatePortfolioRiskImpact() async {
        portfolioRiskRequestId = UUID()
        portfolioRiskImpact = nil
        clearAnnualPortfolioLab(message: "标的已变化；旧组合实验室结果已清除。", membershipId: selectedMembership?.id)
        portfolioRiskMessage = nil

        guard let candidateSymbol = parsedSymbol?.canonical else {
            portfolioRiskMessage = "标的输入无效，未发送风险请求。"
            return
        }
        guard let amount = parsedPortfolioAmount else {
            portfolioRiskMessage = "请输入有效的非负港币情景金额。"
            return
        }
        guard let context = portfolioContext, context.status == .available else {
            portfolioRiskMessage = "只有完整且当前的组合事实可以计算中性风险影响。"
            return
        }

        let requestId = UUID()
        let boundContextId = context.contextId
        let boundSnapshotId = context.portfolioSnapshotId
        let boundAccountScopeId = context.accountScopeId
        portfolioRiskRequestId = requestId
        isLoadingPortfolioRisk = true
        portfolioRiskMessage = "正在计算中性风险影响..."

        defer {
            if portfolioRiskRequestId == requestId {
                isLoadingPortfolioRisk = false
            }
        }

        do {
            let impact = try await portfolioClient.fetchRiskImpact(
                candidateSymbol: candidateSymbol,
                hypotheticalAmount: amount
            )
            guard portfolioRiskRequestId == requestId,
                  parsedSymbol?.canonical == candidateSymbol,
                  parsedPortfolioAmount == amount,
                  portfolioContext?.contextId == boundContextId,
                  portfolioContext?.portfolioSnapshotId == boundSnapshotId,
                  portfolioContext?.accountScopeId == boundAccountScopeId else { return }

            guard impact.status == .available else {
                clearPortfolioAfterRiskFailure(impact.message)
                return
            }
            try validatePortfolioRiskImpactBinding(
                impact: impact,
                context: context,
                candidateSymbol: candidateSymbol,
                hypotheticalAmount: amount
            )
            portfolioRiskImpact = impact
            portfolioRiskMessage = impact.message
        } catch {
            guard portfolioRiskRequestId == requestId,
                  parsedSymbol?.canonical == candidateSymbol,
                  parsedPortfolioAmount == amount,
                  portfolioContext?.contextId == boundContextId,
                  portfolioContext?.portfolioSnapshotId == boundSnapshotId,
                  portfolioContext?.accountScopeId == boundAccountScopeId else { return }
            clearPortfolioAfterRiskFailure(portfolioRiskFailureMessage(error))
        }
    }

    @MainActor
    func invalidatePortfolioForSymbolChange() {
        portfolioContextRequestId = UUID()
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioContext = false
        isLoadingPortfolioRisk = false
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        portfolioContextMessage = "标的已变化，正在重新读取当前组合..."
        portfolioRiskMessage = nil
    }

    @MainActor
    func invalidatePortfolioRiskForAmountChange() {
        portfolioRiskRequestId = UUID()
        isLoadingPortfolioRisk = false
        portfolioRiskImpact = nil
        portfolioRiskMessage = nil
    }

    @MainActor
    private func clearPortfolioContext(_ message: String) {
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        portfolioRiskMessage = nil
        portfolioContextMessage = message
    }

    @MainActor
    private func clearPortfolioAfterRiskFailure(_ message: String) {
        portfolioContextRequestId = UUID()
        portfolioContext = nil
        portfolioLabKnownContextStatus = nil
        portfolioRiskImpact = nil
        portfolioContextMessage = "当前组合需要重新读取。"
        portfolioRiskMessage = message
    }

    private func portfolioContextFailureMessage(_ error: Error) -> String {
        switch error {
        case PortfolioDecisionClientError.httpStatus(401):
            "未认证：当前组合事实已清除。"
        case PortfolioDecisionClientError.httpStatus(409):
            "当前组合来源冲突，旧组合与风险事实已清除。"
        case PortfolioDecisionContextValidationError.invalid:
            "当前组合响应语义无效，旧组合与风险事实已清除。"
        case is DecodingError:
            "当前组合响应格式无效，旧组合与风险事实已清除。"
        case is URLError:
            "当前组合离线，旧组合与风险事实已清除。"
        default:
            "当前组合不可用，旧组合与风险事实已清除。"
        }
    }

    private func portfolioRiskFailureMessage(_ error: Error) -> String {
        switch error {
        case PortfolioRiskImpactBindingError.invalid:
            "风险结果与当前组合事实不匹配，已清除组合与风险结果。"
        case PortfolioRiskImpactValidationError.invalid:
            "风险响应语义无效，已清除组合与风险结果。"
        case PortfolioDecisionClientError.httpStatus(401):
            "风险请求未认证，已清除组合与风险结果。"
        case PortfolioDecisionClientError.httpStatus(409):
            "风险请求期间组合已变化，已清除组合与风险结果。"
        case is DecodingError:
            "风险响应格式无效，已清除组合与风险结果。"
        case is URLError:
            "风险请求离线，已清除组合与风险结果。"
        default:
            "风险请求不可用，已清除组合与风险结果。"
        }
    }
}
