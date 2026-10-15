import Foundation

public protocol MarketQuoteFetching: Sendable {
    func fetchQuote(market: String, code: String) async throws -> MarketQuoteEnvelope
}

public final class MarketQuoteClient: MarketQuoteFetching, @unchecked Sendable {
    let baseURL: URL
    let session: URLSession
    private let authToken: String?
    private let authHeaderName: String
    private let writeAuthToken: String?
    private let writeAuthHeaderName: String

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        authToken: String? = nil,
        authHeaderName: String = "x-internal-token",
        writeAuthToken: String? = nil,
        writeAuthHeaderName: String = "x-internal-token"
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
        self.authHeaderName = authHeaderName
        self.writeAuthToken = writeAuthToken
        self.writeAuthHeaderName = writeAuthHeaderName
    }

    public func refreshQuote(market: String, code: String) async throws -> MarketQuoteEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "internal")
            .appending(path: "market")
            .appending(path: "refresh")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let writeAuthToken, !writeAuthToken.isEmpty {
            request.setValue(writeAuthToken, forHTTPHeaderField: writeAuthHeaderName)
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MarketQuoteClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            if let failClosed = try? decodeQuote(data, market: market, code: code),
               failClosed.status == .unavailable {
                return failClosed
            }
            throw MarketQuoteClientError.httpStatus(httpResponse.statusCode)
        }
        return try decodeQuote(data, market: market, code: code)
    }

    public func fetchQuote(market: String, code: String) async throws -> MarketQuoteEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "quotes")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw MarketQuoteClientError.invalidResponse
        }
        if !(200..<300).contains(httpResponse.statusCode) {
            let failureState = researchHTTPFailureState(httpResponse.statusCode)
            if let failClosed = try? decodeQuote(data, market: market, code: code),
               failClosed.status.rawValue == failureState,
               failClosed.data == nil {
                return failClosed
            }
            throw MarketQuoteClientError.httpStatus(httpResponse.statusCode)
        }
        return try decodeQuote(data, market: market, code: code)
    }

    public func searchHongKongStocks(query: String) async throws -> MarketSearchEnvelope {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let endpoint = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "market")
            .appending(path: "search")
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw MarketQuoteClientError.invalidRequest
        }
        components.queryItems = [URLQueryItem(name: "q", value: normalizedQuery)]
        guard let url = components.url else { throw MarketQuoteClientError.invalidRequest }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MarketQuoteClientError.invalidResponse
        }
        let envelope = try JSONDecoder().decode(MarketSearchEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedQuery: normalizedQuery)
        if !(200..<300).contains(httpResponse.statusCode), envelope.status != .unavailable {
            throw MarketQuoteClientError.httpStatus(httpResponse.statusCode)
        }
        return envelope
    }

    private func decodeQuote(_ data: Data, market: String, code: String) throws -> MarketQuoteEnvelope {
        let envelope = try JSONDecoder().decode(MarketQuoteEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        return envelope
    }

    func applyAuth(to request: inout URLRequest) {
        guard let authToken, !authToken.isEmpty else { return }
        request.setValue(authToken, forHTTPHeaderField: authHeaderName)
    }
}

public enum MarketQuoteClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidRequest
    case invalidResponse
}
