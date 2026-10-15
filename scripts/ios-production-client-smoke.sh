#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BASE_URL="${IOS_PRODUCTION_CLIENT_BASE_URL:-https://audit-service.example.invalid:18443/candidate-api}"
SYMBOL="${IOS_PRODUCTION_CLIENT_SYMBOL:-HK.09926}"
AUTH_TOKEN="${IOS_PRODUCTION_CLIENT_AUTH_TOKEN:-}"
AUTH_HEADER="${IOS_PRODUCTION_CLIENT_AUTH_HEADER:-x-internal-token}"
TLS_INSECURE="${IOS_PRODUCTION_CLIENT_TLS_INSECURE:-0}"
MARKET_CLOSED="${IOS_PRODUCTION_CLIENT_MARKET_CLOSED:-${CANDIDATE_MARKET_CLOSED:-0}}"
RECENT_FETCH_MAX_AGE_SECONDS="${IOS_PRODUCTION_CLIENT_RECENT_FETCH_MAX_AGE_SECONDS:-${CANDIDATE_QUOTE_RECENT_FETCH_MAX_AGE_SECONDS:-1800}}"

cat > "$WORK_DIR/main.swift" <<'SWIFT'
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class InsecureDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard CommandLine.arguments.contains("--tls-insecure"),
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

let baseURL = URL(string: CommandLine.arguments[1])!
let symbol = CommandLine.arguments[2]
let authToken = CommandLine.arguments[3].isEmpty ? nil : CommandLine.arguments[3]
let authHeader = CommandLine.arguments[4]
let marketClosed = CommandLine.arguments[5] == "1"
let recentFetchMaxAgeSeconds = TimeInterval(CommandLine.arguments[6]) ?? 1800
let parts = symbol.split(separator: ".", maxSplits: 1).map(String.init)
precondition(parts.count == 2, "symbol must be MARKET.CODE")

let session = URLSession(
    configuration: .ephemeral,
    delegate: InsecureDelegate(),
    delegateQueue: nil
)

let quoteClient = MarketQuoteClient(
    baseURL: baseURL,
    session: session,
    authToken: authToken,
    authHeaderName: authHeader
)
let researchClient = ResearchClient(
    baseURL: baseURL,
    session: session,
    authToken: authToken,
    authHeaderName: authHeader
)

let quote = try await quoteClient.fetchQuote(market: parts[0], code: parts[1])
precondition(quote.source.provider == .futu, "expected Futu quote provider")
precondition(quote.data?.symbol == symbol, "unexpected quote symbol")
let quoteAccepted: Bool
let quoteGate: String
if quote.status == .live {
    quoteAccepted = true
    quoteGate = "live"
} else if quote.status == .stale,
          marketClosed,
          let fetchedAt = quote.source.fetchedAt.flatMap(parseISO8601),
          Date().timeIntervalSince(fetchedAt) >= 0,
          Date().timeIntervalSince(fetchedAt) <= recentFetchMaxAgeSeconds,
          quote.data?.quoteTime.isEmpty == false {
    quoteAccepted = true
    quoteGate = "market_closed_stale"
} else {
    quoteAccepted = false
    quoteGate = "not_acceptable"
}
precondition(quoteAccepted, "expected live quote or recent market-closed stale Futu quote")

let research = try await researchClient.fetchProfile(market: parts[0], code: parts[1])
precondition(research.data?.profile.symbol == symbol, "unexpected research profile symbol")
precondition((research.data?.evidence.count ?? 0) > 0, "expected research evidence")

print("iOS production client smoke passed: \(symbol) quote=\(quote.status.rawValue) gate=\(quoteGate) provider=\(quote.source.provider.rawValue) evidence=\(research.data?.evidence.count ?? 0)")

func parseISO8601(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
        return date
    }
    return ISO8601DateFormatter().date(from: value)
}
SWIFT

swiftc \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/MarketQuoteModels.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/MarketQuoteClient.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchModels.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClientResponseValidation.swift \
  apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/ResearchClient.swift \
  "$WORK_DIR/main.swift" \
  -o "$WORK_DIR/ios-production-client-smoke"

args=("$BASE_URL" "$SYMBOL" "$AUTH_TOKEN" "$AUTH_HEADER" "$MARKET_CLOSED" "$RECENT_FETCH_MAX_AGE_SECONDS")
if [[ "$TLS_INSECURE" == "1" ]]; then
  args+=("--tls-insecure")
fi

"$WORK_DIR/ios-production-client-smoke" "${args[@]}"
