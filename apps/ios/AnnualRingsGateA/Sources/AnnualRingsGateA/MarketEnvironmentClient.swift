import Foundation

public final class MarketEnvironmentClient: @unchecked Sendable {
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

    public func fetch(market: String, code: String) async throws -> MarketEnvironmentEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "environment")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 35
        if let authToken, !authToken.isEmpty { request.setValue(authToken, forHTTPHeaderField: authHeaderName) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw MarketEnvironmentClientError.invalidResponse }
        let envelope = try JSONDecoder().decode(MarketEnvironmentEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedSymbol: "\(market).\(code)")
        if !(200..<300).contains(response.statusCode), envelope.status != .unavailable {
            throw MarketEnvironmentClientError.httpStatus(response.statusCode)
        }
        return envelope
    }
}

public enum MarketEnvironmentClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
}
