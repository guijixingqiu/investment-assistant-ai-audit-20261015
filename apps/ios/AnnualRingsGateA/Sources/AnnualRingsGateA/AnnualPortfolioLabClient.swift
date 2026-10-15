import Foundation

public protocol AnnualPortfolioLabFetching: Sendable {
    func fetchPortfolioLab(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        scenarioAmounts: [Double]
    ) async -> AnnualPortfolioLabEnvelope
}

public final class AnnualPortfolioLabClient: AnnualPortfolioLabFetching, @unchecked Sendable {
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

    public func fetchPortfolioLab(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        scenarioAmounts: [Double]
    ) async -> AnnualPortfolioLabEnvelope {
        guard let url = requestURL(membershipId: membershipId, scenarioAmounts: scenarioAmounts),
              membershipVersion > 0,
              SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol else {
            return .unavailable("组合实验室输入无效，未发送请求。", membershipId: membershipId, clientFailureState: "malformed")
        }
        var request = URLRequest(url: url)
        if let authToken, !authToken.isEmpty {
            request.setValue(authToken, forHTTPHeaderField: authHeaderName)
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unavailable(
                    "组合实验室响应缺少有效 HTTP 状态，已阻止展示。",
                    membershipId: membershipId
                )
            }
            if !(200..<300).contains(http.statusCode) {
                return await failClosedHTTPResponse(
                    data,
                    statusCode: http.statusCode,
                    membershipId: membershipId,
                    membershipVersion: membershipVersion,
                    symbol: symbol,
                    scenarioAmounts: scenarioAmounts
                )
            }
            return try await MainActor.run {
                try self.decode(
                    data,
                    membershipId: membershipId,
                    membershipVersion: membershipVersion,
                    symbol: symbol,
                    scenarioAmounts: scenarioAmounts
                )
            }
        } catch is DecodingError {
            return .unavailable("组合实验室响应格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch AnnualPortfolioLabValidationError.invalid {
            return .unavailable("组合实验室响应语义、身份或复算结果无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch {
            return .unavailable("组合实验室离线或不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "offline")
        }
    }

    private func failClosedHTTPResponse(
        _ data: Data,
        statusCode: Int,
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        scenarioAmounts: [Double]
    ) async -> AnnualPortfolioLabEnvelope {
        let failureState = researchHTTPFailureState(statusCode)
        let decoded = try? await MainActor.run {
            try self.decode(
                data,
                membershipId: membershipId,
                membershipVersion: membershipVersion,
                symbol: symbol,
                scenarioAmounts: scenarioAmounts
            )
        }
        let safeMessage = decoded.flatMap { envelope in
            envelope.status != "available" && envelope.data == nil ? envelope.message : nil
        }
        return .unavailable(
            safeMessage ?? httpFailureMessage(for: failureState),
            membershipId: membershipId,
            clientFailureState: failureState
        )
    }

    private func httpFailureMessage(for failureState: String) -> String {
        switch failureState {
        case "unauthorized":
            return "未认证：需要账户范围读取授权。"
        case "malformed":
            return "组合实验室输入无效，旧结果已清除。"
        case "not_found":
            return "研究自选成员不存在，旧结果已清除。"
        case "conflict":
            return "账户、快照、候选或报价事实冲突，旧结果已清除。"
        default:
            return "组合实验室不可用，旧结果已清除。"
        }
    }

    private func requestURL(membershipId: String, scenarioAmounts: [Double]) -> URL? {
        guard membershipId.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil,
              (1...4).contains(scenarioAmounts.count),
              scenarioAmounts.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1_000_000_000_000 }) else {
            return nil
        }
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "portfolio-lab")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = scenarioAmounts.map {
            URLQueryItem(name: "scenarioAmount", value: String($0))
        }
        return components?.url
    }

    private func decode(
        _ data: Data,
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        scenarioAmounts: [Double]
    ) throws -> AnnualPortfolioLabEnvelope {
        try validateAnnualPortfolioLabRawShape(data)
        let envelope = try JSONDecoder().decode(AnnualPortfolioLabEnvelope.self, from: data)
        return try envelope.validated(
            expectedMembershipId: membershipId,
            expectedMembershipVersion: membershipVersion,
            expectedSymbol: symbol,
            expectedAmounts: scenarioAmounts
        )
    }
}
