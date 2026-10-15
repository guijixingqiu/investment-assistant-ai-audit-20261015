import Foundation

public struct SecuritySymbol: Equatable, Sendable {
    public let market: String
    public let code: String

    public var canonical: String {
        "\(market).\(code)"
    }

    public init(market: String, code: String) {
        self.market = market
        self.code = code
    }

    public static func parseHongKongAlias(_ input: String) -> SecuritySymbol? {
        let normalized = input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if normalized.range(of: #"^[0-9]{5}$"#, options: .regularExpression) != nil {
            return SecuritySymbol(market: "HK", code: normalized)
        }
        let parts = normalized.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2 else {
            return nil
        }
        if parts[0] == "HK",
           parts[1].range(of: #"^\d{5}$"#, options: .regularExpression) != nil {
            return SecuritySymbol(market: "HK", code: parts[1])
        }
        if parts[1] == "HK",
           parts[0].range(of: #"^\d{5}$"#, options: .regularExpression) != nil {
            return SecuritySymbol(market: "HK", code: parts[0])
        }
        return nil
    }
}
