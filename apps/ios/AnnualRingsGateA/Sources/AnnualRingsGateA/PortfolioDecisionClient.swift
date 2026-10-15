import Foundation

public protocol PortfolioDecisionFetching: Sendable {
    func fetchContext() async throws -> PortfolioDecisionContextEnvelope
    func fetchRiskImpact(candidateSymbol: String, hypotheticalAmount: Double) async throws -> PortfolioRiskImpactEnvelope
}

public enum PortfolioDecisionClientError: Error, Equatable, Sendable {
    case invalidCandidateSymbol
    case invalidHypotheticalAmount
    case invalidResponse
    case httpStatus(Int)
}

public final class PortfolioDecisionClient: PortfolioDecisionFetching, @unchecked Sendable {
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

    public func fetchContext() async throws -> PortfolioDecisionContextEnvelope {
        let url = portfolioBaseURL.appending(path: "context")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyReadAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PortfolioDecisionClientError.invalidResponse
        }
        if !(200..<300).contains(httpResponse.statusCode),
           let failClosed = try? decodeContext(data),
           failClosed.status.httpFailureState == researchHTTPFailureState(httpResponse.statusCode),
           failClosed.isFactFreeHTTPFailure {
            return failClosed
        }
        try validate(httpResponse: httpResponse)
        return try decodeContext(data)
    }

    public func fetchRiskImpact(
        candidateSymbol: String,
        hypotheticalAmount: Double
    ) async throws -> PortfolioRiskImpactEnvelope {
        guard SecuritySymbol.parseHongKongAlias(candidateSymbol)?.canonical == candidateSymbol else {
            throw PortfolioDecisionClientError.invalidCandidateSymbol
        }
        guard hypotheticalAmount.isFinite, hypotheticalAmount >= 0 else {
            throw PortfolioDecisionClientError.invalidHypotheticalAmount
        }
        var components = URLComponents(
            url: portfolioBaseURL.appending(path: "risk-impact"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "symbol", value: candidateSymbol),
            URLQueryItem(name: "hypotheticalAmount", value: String(hypotheticalAmount))
        ]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        applyReadAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PortfolioDecisionClientError.invalidResponse
        }
        if !(200..<300).contains(httpResponse.statusCode),
           let failClosed = try? decodeRiskImpact(data),
           failClosed.status.httpFailureState == researchHTTPFailureState(httpResponse.statusCode),
           failClosed.isFactFreeHTTPFailure {
            return failClosed
        }
        try validate(httpResponse: httpResponse)
        return try decodeRiskImpact(data)
    }

    private var portfolioBaseURL: URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "portfolio")
            .appending(path: "current")
    }

    private func decodeContext(_ data: Data) throws -> PortfolioDecisionContextEnvelope {
        let envelope = try JSONDecoder().decode(PortfolioDecisionContextEnvelope.self, from: data)
        try envelope.validateForDisplay()
        if let contextId = envelope.contextId {
            let expected = try portfolioDecisionContextContentId(rawJSON: data)
            if contextId != expected {
                throw PortfolioDecisionContextValidationError.invalid([
                    "contextId does not match canonical content"
                ])
            }
        }
        return envelope
    }

    private func decodeRiskImpact(_ data: Data) throws -> PortfolioRiskImpactEnvelope {
        let envelope = try JSONDecoder().decode(PortfolioRiskImpactEnvelope.self, from: data)
        try envelope.validateForDisplay()
        if let impactId = envelope.impactId {
            let expected = try portfolioDecisionContentId(
                rawJSON: data,
                prefix: "portfolio-risk-impact:",
                excludingTopLevelKeys: ["impactId"]
            )
            if impactId != expected {
                throw PortfolioRiskImpactValidationError.invalid([
                    "impactId does not match canonical content"
                ])
            }
        }
        return envelope
    }

    private func applyReadAuth(to request: inout URLRequest) {
        guard let authToken, !authToken.isEmpty else { return }
        request.setValue(authToken, forHTTPHeaderField: authHeaderName)
    }

    private func validate(httpResponse: HTTPURLResponse) throws {
        if !(200..<300).contains(httpResponse.statusCode) {
            throw PortfolioDecisionClientError.httpStatus(httpResponse.statusCode)
        }
    }
}

private extension PortfolioDecisionContextStatus {
    var httpFailureState: String? {
        switch self {
        case .empty:
            return "not_found"
        case .conflict:
            return "conflict"
        case .unauthorized:
            return "unauthorized"
        case .unavailable:
            return "unavailable"
        case .available, .stale, .partial, .zeroPosition:
            return nil
        }
    }
}

private extension PortfolioDecisionContextEnvelope {
    var isFactFreeHTTPFailure: Bool {
        status.httpFailureState != nil &&
            contextId == nil &&
            portfolioSnapshotId == nil &&
            portfolioSource == nil &&
            portfolioAsOf == nil &&
            positions.isEmpty &&
            summary.positionCount == 0 &&
            summary.marketValue.amount == nil &&
            summary.marketValue.currency == nil &&
            summary.concentration.largestPositionWeight == nil &&
            summary.concentration.topThreeWeight == nil &&
            summary.concentration.hhi == nil
    }
}

private extension PortfolioRiskImpactStatus {
    var httpFailureState: String? {
        switch self {
        case .blocked:
            return "conflict"
        case .invalid:
            return "malformed"
        case .available:
            return nil
        }
    }
}

private extension PortfolioRiskImpactEnvelope {
    var isFactFreeHTTPFailure: Bool {
        status.httpFailureState != nil &&
            impactId == nil &&
            current.alreadyHeld == nil &&
            current.marketValue == nil &&
            current.weight == nil &&
            scenario.totalMarketValue == nil &&
            scenario.candidateMarketValue == nil &&
            scenario.candidateWeight == nil &&
            scenario.weightChange == nil &&
            scenario.largestPositionWeight == nil &&
            scenario.hhi == nil
    }
}
