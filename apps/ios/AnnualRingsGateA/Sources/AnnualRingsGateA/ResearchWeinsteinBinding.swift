import Foundation

public struct FrozenWeinsteinEvidenceBinding: Codable, Equatable, Sendable {
    public let bindingVersion: String
    public let schemaVersion: String
    public let computationVersion: String
    public let provider: String
    public let dataset: String
    public let hashMethod: String
    public let datasetHash: String
    public let symbol: String
    public let analysisAsOf: String
    public let completedWeekEnd: String
    public let sectorIdentityAsOf: String
    public let inputHash: String
    public let resultHash: String

    public init(
        bindingVersion: String,
        schemaVersion: String,
        computationVersion: String,
        provider: String,
        dataset: String,
        hashMethod: String,
        datasetHash: String,
        symbol: String,
        analysisAsOf: String,
        completedWeekEnd: String,
        sectorIdentityAsOf: String,
        inputHash: String,
        resultHash: String
    ) {
        self.bindingVersion = bindingVersion
        self.schemaVersion = schemaVersion
        self.computationVersion = computationVersion
        self.provider = provider
        self.dataset = dataset
        self.hashMethod = hashMethod
        self.datasetHash = datasetHash
        self.symbol = symbol
        self.analysisAsOf = analysisAsOf
        self.completedWeekEnd = completedWeekEnd
        self.sectorIdentityAsOf = sectorIdentityAsOf
        self.inputHash = inputHash
        self.resultHash = resultHash
    }

    public init?(envelope: WeinsteinTechnicalAnalysisEnvelope) {
        guard envelope.status == "available",
              let provider = envelope.provider,
              let dataset = envelope.dataset,
              let hashMethod = envelope.hashMethod,
              let datasetHash = envelope.datasetHash,
              let completedWeekEnd = envelope.completedWeekEnd,
              let sectorIdentityAsOf = envelope.sectorIdentityAsOf,
              let inputHash = envelope.inputHash,
              let resultHash = envelope.resultHash else { return nil }
        self.bindingVersion = "research.weinstein.freeze.1"
        self.schemaVersion = envelope.schemaVersion
        self.computationVersion = envelope.computationVersion
        self.provider = provider
        self.dataset = dataset
        self.hashMethod = hashMethod
        self.datasetHash = datasetHash
        self.symbol = envelope.symbol
        self.analysisAsOf = envelope.analysisAsOf
        self.completedWeekEnd = completedWeekEnd
        self.sectorIdentityAsOf = sectorIdentityAsOf
        self.inputHash = inputHash
        self.resultHash = resultHash
    }

    public func invalidatedBy(_ current: WeinsteinTechnicalAnalysisEnvelope?) -> [String] {
        guard let current else { return ["weinstein_current_result_missing"] }
        guard let next = FrozenWeinsteinEvidenceBinding(envelope: current) else {
            return ["weinstein_current_result_invalid"]
        }
        return next == self ? [] : ["weinstein_result_changed"]
    }

    public func validated(expectedSymbol: String, analysisAsOf expectedAsOf: String) throws -> Self {
        guard bindingVersion == "research.weinstein.freeze.1",
              schemaVersion == "2026-08-13.weinstein-technical.v6",
              computationVersion == "weinstein.weekly-stage.6",
              provider == "futu_opend",
              dataset == "futu.weinstein.completed-weekly-ohlcv.v1",
              hashMethod == "sha256-canonical-json-v1",
              [datasetHash, inputHash, resultHash].allSatisfy({ $0.isWeinsteinSHA256 }),
              symbol == expectedSymbol,
              analysisAsOf == expectedAsOf,
              completedWeekEnd == weinsteinCompletedWeekEnd(expectedAsOf),
              sectorIdentityAsOf == expectedAsOf else {
            throw WeinsteinTechnicalAnalysisError.invalid(["frozen Weinstein binding is invalid"])
        }
        return self
    }
}

private func weinsteinCompletedWeekEnd(_ analysisAsOf: String) -> String? {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: analysisAsOf) else { return nil }
    let weekday = formatter.calendar.component(.weekday, from: date)
    let daysSinceFriday = (weekday - 6 + 7) % 7
    return formatter.calendar.date(
        byAdding: .day,
        value: -(daysSinceFriday == 0 ? 7 : daysSinceFriday),
        to: date
    ).map(formatter.string)
}

private extension String {
    var isWeinsteinSHA256: Bool {
        range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }
}
