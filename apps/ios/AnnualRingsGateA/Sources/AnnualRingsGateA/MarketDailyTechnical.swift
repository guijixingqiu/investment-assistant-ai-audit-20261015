import Foundation

public enum MarketDailyStatus: String, Codable, Equatable, Sendable {
    case available
    case incomplete
    case unavailable
}

public struct MarketDailyTechnicalEnvelope: Codable, Equatable, Sendable {
    public let completeness: String
    public let usableForRequestedCutoff: Bool
    public let dailyBars: MarketDailyBarsEnvelope
    public let technical: MarketTechnicalEnvelope

    public func isBound(to canonicalSymbol: String) -> Bool {
        dailyBars.request.symbol == canonicalSymbol
    }

    public static func unavailable(
        _ message: String,
        market: String,
        code: String,
        cutoff: String
    ) -> Self {
        let request = MarketDailyRequest(
            market: market,
            code: code,
            symbol: "\(market).\(code)",
            timeframe: "1d",
            completedSessionsOnly: true,
            adjustment: "forward_qfq_research_only",
            minimumBars: 80,
            targetBars: 120,
            cutoff: cutoff
        )
        return Self(
            completeness: "incomplete",
            usableForRequestedCutoff: false,
            dailyBars: MarketDailyBarsEnvelope(
                schemaVersion: "2026-07-29.f1a-daily.v3",
                status: .unavailable,
                request: request,
                source: .unavailable,
                metadata: FactMetadata(
                    source: "market_daily:unavailable",
                    asOf: nil,
                    fetchedAt: nil,
                    freshness: "unavailable",
                    provenance: "unavailable",
                    authority: "unavailable",
                    stale: false,
                    missing: false,
                    conflict: false,
                    fixture: false,
                    correctionOf: nil,
                    replaces: nil,
                    message: message
                ),
                snapshot: nil,
                message: message
            ),
            technical: .unavailable(message)
        )
    }
}

public struct MarketDailyBarsEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketDailyStatus
    public let request: MarketDailyRequest
    public let source: MarketDailySource
    public let metadata: FactMetadata?
    public let snapshot: MarketDailySnapshot?
    public let message: String

}

public struct MarketDailyRequest: Codable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let symbol: String
    public let timeframe: String
    public let completedSessionsOnly: Bool
    public let adjustment: String
    public let minimumBars: Int
    public let targetBars: Int
    public let cutoff: String
}

public struct MarketDailySource: Codable, Equatable, Sendable {
    public let provider: String
    public let endpoint: String?
    public let fetchedAt: String?
    public let providerCutoff: String?
    public let dataCutoffAt: String?
    public let rights: String
    public let retention: String
    public let derivedUse: String
    public let hashMethod: String
    public let rawBytesCaptured: Bool
    public let pageCount: Int
    public let pageContentHashes: [String]
    public let sourceContentHash: String?

    fileprivate static let unavailable = Self(
        provider: "unavailable",
        endpoint: nil,
        fetchedAt: nil,
        providerCutoff: nil,
        dataCutoffAt: nil,
        rights: "unknown",
        retention: "unknown",
        derivedUse: "unknown",
        hashMethod: "sha256_canonical_json_v1",
        rawBytesCaptured: false,
        pageCount: 0,
        pageContentHashes: [],
        sourceContentHash: nil
    )
}

public struct MarketDailySnapshot: Codable, Equatable, Sendable {
    public let snapshotSha: String
    public let dataHash: String
    public let calendar: MarketDailyCalendar
    public let lastCompletedSession: String
    public let firstSession: String
    public let lastSession: String
    public let barCount: Int
    public let expectedSessions: [String]
    public let quality: MarketDailyQuality
    public let bars: [MarketDailyBar]

}

public struct MarketDailyCalendar: Codable, Equatable, Sendable {
    public let id: String
    public let version: String
    public let timezone: String
}

public struct MarketDailyQuality: Codable, Equatable, Sendable {
    public let gaps: [MarketDailyGap]
    public let zeroVolumeSessions: [String]
    public let suspensionSessions: [String]
}

public struct MarketDailyGap: Codable, Equatable, Sendable {
    public let session: String
    public let classification: String
}

public struct MarketDailyBar: Codable, Equatable, Sendable {
    public let session: String
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
    public let volume: Double
    public let turnover: Double
    public let suspension: Bool

}

public struct MarketTechnicalEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: MarketDailyStatus
    public let computationVersion: String
    public let parameters: MarketTechnicalParameters
    public let inputSnapshotSha: String?
    public let dataCutoffAt: String?
    public let resultHash: String?
    public let points: [MarketTechnicalPoint]?
    public let message: String

    fileprivate static func unavailable(_ message: String) -> Self {
        Self(
            schemaVersion: "2026-07-29.f1a-technical.v3",
            status: .unavailable,
            computationVersion: "f1a.indicators.3",
            parameters: .canonical,
            inputSnapshotSha: nil,
            dataCutoffAt: nil,
            resultHash: nil,
            points: nil,
            message: message
        )
    }
}

public struct MarketTechnicalParameters: Codable, Equatable, Sendable {
    public let ma: [Int]
    public let macd: MarketMacdParameters
    public let bollinger: MarketBollingerParameters
    public let rsi: MarketRsiParameters

    static let canonical = Self(
        ma: [20, 60],
        macd: .init(fast: 12, slow: 26, signal: 9),
        bollinger: .init(window: 20, standardDeviations: 2, variance: "population"),
        rsi: .init(period: 14, smoothing: "wilder")
    )
}

public struct MarketMacdParameters: Codable, Equatable, Sendable {
    public let fast: Int
    public let slow: Int
    public let signal: Int
}

public struct MarketBollingerParameters: Codable, Equatable, Sendable {
    public let window: Int
    public let standardDeviations: Int
    public let variance: String
}

public struct MarketRsiParameters: Codable, Equatable, Sendable {
    public let period: Int
    public let smoothing: String
}

public struct MarketTechnicalPoint: Codable, Equatable, Sendable {
    public let session: String
    public let candle: MarketTechnicalCandle
    public let volume: Double
    public let ma20: Double?
    public let ma60: Double?
    public let macd: MarketMacdPoint
    public let bollinger20: MarketBollingerPoint?
    public let rsi14: Double?

}

public struct MarketTechnicalCandle: Codable, Equatable, Sendable {
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double

}

public struct MarketMacdPoint: Codable, Equatable, Sendable {
    public let ema12: Double?
    public let ema26: Double?
    public let line: Double?
    public let signal: Double?
    public let histogram: Double?
}

public struct MarketBollingerPoint: Codable, Equatable, Sendable {
    public let middle: Double
    public let standardDeviation: Double
    public let upper: Double
    public let lower: Double

}

public enum MarketDailyTechnicalValidationError: Error, Equatable, Sendable {
    case invalid([String])
}
