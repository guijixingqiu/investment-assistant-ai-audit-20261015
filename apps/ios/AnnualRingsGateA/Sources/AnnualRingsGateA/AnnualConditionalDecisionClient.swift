import Foundation

public protocol AnnualConditionalDecisionPreviewFetching: Sendable {
    func fetchConditionalDecisionPreview(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int
    ) async -> AnnualConditionalDecisionPreviewEnvelope
}

public final class AnnualConditionalDecisionPreviewClient: AnnualConditionalDecisionPreviewFetching, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let authToken: String?
    private let authHeaderName: String

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        authToken: String? = nil,
        authHeaderName: String = "x-internal-token"
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
        self.authHeaderName = authHeaderName
    }

    public func fetchConditionalDecisionPreview(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int
    ) async -> AnnualConditionalDecisionPreviewEnvelope {
        guard let url = requestURL(
            membershipId: membershipId,
            valuation: valuation,
            quantFilter: quantFilter,
            scenarioAmounts: scenarioAmounts,
            selectedScenarioIndex: selectedScenarioIndex
        ), membershipVersion > 0, SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol else {
            return .unavailable("条件决策预览输入无效，未发送请求。", membershipId: membershipId, clientFailureState: "malformed")
        }
        var request = URLRequest(url: url)
        if let authToken, !authToken.isEmpty { request.setValue(authToken, forHTTPHeaderField: authHeaderName) }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unavailable(
                    "条件决策预览响应无效，已阻止展示。",
                    membershipId: membershipId,
                    clientFailureState: "unavailable"
                )
            }
            if !(200..<300).contains(http.statusCode) {
                let failureState = researchHTTPFailureState(http.statusCode)
                if let failClosed = try? await MainActor.run(body: {
                    try self.decode(
                        data,
                        membershipId: membershipId,
                        membershipVersion: membershipVersion,
                        symbol: symbol,
                        valuation: valuation,
                        quantFilter: quantFilter,
                        scenarioAmounts: scenarioAmounts,
                        selectedScenarioIndex: selectedScenarioIndex
                    )
                }), failClosed.status != "available", failClosed.data == nil {
                    return .unavailable(
                        failClosed.message,
                        membershipId: membershipId,
                        clientFailureState: failureState
                    )
                }
                return .unavailable(
                    httpFailureMessage(failureState),
                    membershipId: membershipId,
                    clientFailureState: failureState
                )
            }
            return try await MainActor.run {
                try self.decode(
                    data,
                    membershipId: membershipId,
                    membershipVersion: membershipVersion,
                    symbol: symbol,
                    valuation: valuation,
                    quantFilter: quantFilter,
                    scenarioAmounts: scenarioAmounts,
                    selectedScenarioIndex: selectedScenarioIndex
                )
            }
        } catch is AnnualConditionalDecisionValidationError {
            return .unavailable("条件决策预览语义、身份或规范哈希无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch is DecodingError {
            return .unavailable("条件决策预览格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch {
            return .unavailable("条件决策预览离线或不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "offline")
        }
    }

    private func httpFailureMessage(_ failureState: String) -> String {
        switch failureState {
        case "unauthorized": "未认证：需要账户范围读取授权。"
        case "malformed": "条件决策预览输入无效，旧预览已清除。"
        case "not_found": "研究自选成员不存在，旧预览已清除。"
        case "conflict": "条件决策事实未就绪或相互冲突，旧预览已清除。"
        default: "条件决策预览服务不可用，旧预览已清除。"
        }
    }

    private func decode(
        _ raw: Data,
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int
    ) throws -> AnnualConditionalDecisionPreviewEnvelope {
        try validateAnnualConditionalDecisionPreviewRawShape(raw)
        let envelope = try JSONDecoder().decode(AnnualConditionalDecisionPreviewEnvelope.self, from: raw)
        return try envelope.validated(
            expectedMembershipId: membershipId,
            expectedMembershipVersion: membershipVersion,
            expectedSymbol: symbol,
            valuation: valuation,
            quantFilter: quantFilter,
            scenarioAmounts: scenarioAmounts,
            selectedScenarioIndex: selectedScenarioIndex
        )
    }

    private func requestURL(
        membershipId: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput,
        scenarioAmounts: [Double],
        selectedScenarioIndex: Int
    ) -> URL? {
        guard membershipId.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil,
              let metricCurrency = valuation.metricCurrency,
              (1...4).contains(scenarioAmounts.count), scenarioAmounts.indices.contains(selectedScenarioIndex),
              scenarioAmounts.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1_000_000_000_000 }) else { return nil }
        let url = baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research")
            .appending(path: "candidate-memberships").appending(path: membershipId).appending(path: "conditional-decision-preview")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "metricCurrency", value: metricCurrency),
            URLQueryItem(name: "baseMetricPerShare", value: String(valuation.baseMetricPerShare)),
            URLQueryItem(name: "annualGrowthRate", value: String(valuation.annualGrowthRate)),
            URLQueryItem(name: "horizonYears", value: String(valuation.horizonYears)),
            URLQueryItem(name: "terminalMultiple", value: String(valuation.terminalMultiple)),
            URLQueryItem(name: "annualDiscountRate", value: String(valuation.annualDiscountRate)),
            URLQueryItem(name: "netCashPerShare", value: String(valuation.netCashPerShare)),
            URLQueryItem(name: "growthRateStep", value: String(valuation.growthRateStep)),
            URLQueryItem(name: "multipleStep", value: String(valuation.multipleStep)),
            URLQueryItem(name: "maxDrawdownMagnitude", value: String(quantFilter.maxDrawdownMagnitude)),
            URLQueryItem(name: "maxTurnoverOneWay", value: String(quantFilter.maxTurnoverOneWay)),
            URLQueryItem(name: "minTradeCount", value: String(quantFilter.minTradeCount)),
            URLQueryItem(name: "selectedPortfolioScenarioIndex", value: String(selectedScenarioIndex))
        ] + scenarioAmounts.map { URLQueryItem(name: "scenarioAmount", value: String($0)) }
        return components?.url
    }
}
