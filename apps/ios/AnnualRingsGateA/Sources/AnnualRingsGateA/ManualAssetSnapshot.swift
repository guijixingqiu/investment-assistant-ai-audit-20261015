import Foundation

public let MANUAL_ASSET_SNAPSHOT_SCHEMA_VERSION = "2026-08-04.manual-asset-snapshot.v1"

public enum ManualAssetSnapshotValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct ManualAssetPosition: Codable, Equatable, Identifiable, Sendable {
    public var id: String { symbol }

    public let symbol: String
    public let quantity: Double
    public let marketValue: Double?
    public let currency: String

    public init(symbol: String, quantity: Double, marketValue: Double?, currency: String = "HKD") throws {
        self.symbol = symbol
        self.quantity = quantity
        self.marketValue = marketValue
        self.currency = currency
        try validate()
    }

    fileprivate func validate() throws {
        var errors: [String] = []
        if SecuritySymbol.parseHongKongAlias(symbol)?.canonical != symbol {
            errors.append("manual asset position requires a canonical Hong Kong symbol")
        }
        if !quantity.isFinite || quantity <= 0 {
            errors.append("manual asset quantity must be finite and positive")
        }
        if let marketValue, (!marketValue.isFinite || marketValue < 0) {
            errors.append("manual asset market value must be finite and non-negative when present")
        }
        if currency != "HKD" {
            errors.append("manual asset currency must be HKD")
        }
        if !errors.isEmpty {
            throw ManualAssetSnapshotValidationError.invalid(errors)
        }
    }
}

public struct ManualAssetKnownMarketValueSummary: Equatable, Sendable {
    public let knownPositionCount: Int
    public let totalPositionCount: Int
    public let total: Double
    public let weightsBySymbol: [String: Double]

    public var largestWeight: Double? { weightsBySymbol.values.max() }
    public var topThreeWeight: Double? {
        guard !weightsBySymbol.isEmpty else { return nil }
        return weightsBySymbol.values.sorted(by: >).prefix(3).reduce(0, +)
    }
    public var hhi: Double? {
        guard !weightsBySymbol.isEmpty else { return nil }
        return weightsBySymbol.values.reduce(0) { $0 + $1 * $1 }
    }
}

public struct ManualAssetSnapshot: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let source: String
    public let ingress: String?
    public let accountScope: String?
    public let sourceHash: String?
    public let importActor: String?
    public let reconciliationState: String?
    public let asOf: String
    public let savedAt: String
    public let positions: [ManualAssetPosition]
    public let cashStatus: String
    public let localOnly: Bool
    public let apiUploaded: Bool
    public let databaseWritten: Bool
    public let brokerSynced: Bool
    public let officialPortfolioFact: Bool
    public let productionFact: Bool

    public var asOfDate: Date? { manualAssetDate(asOf) }
    public var knownMarketValueSummary: ManualAssetKnownMarketValueSummary {
        let knownValues = positions.compactMap { position in
            position.marketValue.map { (position.symbol, $0) }
        }
        let total = knownValues.reduce(0) { $0 + $1.1 }
        let weights = total > 0
            ? knownValues.reduce(into: [String: Double]()) {
                $0[$1.0, default: 0] += $1.1 / total
            }
            : [:]
        return ManualAssetKnownMarketValueSummary(
            knownPositionCount: knownValues.count,
            totalPositionCount: positions.count,
            total: total,
            weightsBySymbol: weights
        )
    }

    public init(
        positions: [ManualAssetPosition],
        asOf: String,
        savedAt: String,
        schemaVersion: String = MANUAL_ASSET_SNAPSHOT_SCHEMA_VERSION,
        source: String = "owner_manual_local_snapshot",
        ingress: String? = "manual",
        accountScope: String? = "owner_local_unscoped",
        sourceHash: String? = nil,
        importActor: String? = "owner_local_user",
        reconciliationState: String? = "not_reconciled",
        cashStatus: String = "unknown",
        localOnly: Bool = true,
        apiUploaded: Bool = false,
        databaseWritten: Bool = false,
        brokerSynced: Bool = false,
        officialPortfolioFact: Bool = false,
        productionFact: Bool = false
    ) throws {
        self.schemaVersion = schemaVersion
        self.source = source
        self.ingress = ingress
        self.accountScope = accountScope
        self.sourceHash = sourceHash
        self.importActor = importActor
        self.reconciliationState = reconciliationState
        self.asOf = asOf
        self.savedAt = savedAt
        self.positions = positions.sorted { $0.symbol < $1.symbol }
        self.cashStatus = cashStatus
        self.localOnly = localOnly
        self.apiUploaded = apiUploaded
        self.databaseWritten = databaseWritten
        self.brokerSynced = brokerSynced
        self.officialPortfolioFact = officialPortfolioFact
        self.productionFact = productionFact
        try validate()
    }

    public static func local(
        positions: [ManualAssetPosition],
        asOf: Date,
        savedAt: Date = Date()
    ) throws -> ManualAssetSnapshot {
        try ManualAssetSnapshot(
            positions: positions,
            asOf: manualAssetTimestamp(asOf),
            savedAt: manualAssetTimestamp(savedAt)
        )
    }

    public static func csv(
        positions: [ManualAssetPosition],
        asOf: String,
        sourceHash: String,
        savedAt: Date = Date()
    ) throws -> ManualAssetSnapshot {
        try ManualAssetSnapshot(
            positions: positions,
            asOf: asOf,
            savedAt: manualAssetTimestamp(savedAt),
            ingress: "csv",
            sourceHash: sourceHash
        )
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != MANUAL_ASSET_SNAPSHOT_SCHEMA_VERSION {
            errors.append("manual asset snapshot schemaVersion is invalid")
        }
        if source != "owner_manual_local_snapshot" || cashStatus != "unknown" {
            errors.append("manual asset source and cash boundary are invalid")
        }
        let hasLegacyMetadata = ingress == nil && accountScope == nil && sourceHash == nil
            && importActor == nil && reconciliationState == nil
        if !hasLegacyMetadata {
            if (ingress != "manual" && ingress != "csv")
                || accountScope != "owner_local_unscoped"
                || importActor != "owner_local_user"
                || reconciliationState != "not_reconciled" {
                errors.append("manual asset import provenance is invalid")
            }
            if ingress == "csv" {
                if sourceHash?.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) == nil {
                    errors.append("CSV sourceHash must be lowercase SHA-256")
                }
            } else if sourceHash != nil {
                errors.append("manual entry must not claim a source file hash")
            }
        }
        guard let asOfDate = manualAssetDate(asOf), let savedAtDate = manualAssetDate(savedAt) else {
            errors.append("manual asset timestamps must be strict UTC instants")
            throw ManualAssetSnapshotValidationError.invalid(errors)
        }
        if asOfDate > savedAtDate {
            errors.append("manual asset as-of time cannot be later than savedAt")
        }
        if positions.count > 100 {
            errors.append("manual asset snapshot allows 0...100 positions")
        }
        if Set(positions.map(\.symbol)).count != positions.count {
            errors.append("manual asset symbols must be unique")
        }
        if !positions.compactMap(\.marketValue).reduce(0, +).isFinite {
            errors.append("manual asset known market value total must be finite")
        }
        for position in positions {
            do { try position.validate() } catch {
                errors.append("manual asset position is invalid")
            }
        }
        if !localOnly || apiUploaded || databaseWritten || brokerSynced || officialPortfolioFact || productionFact {
            errors.append("manual asset snapshot must remain local-only and unofficial")
        }
        if !errors.isEmpty {
            throw ManualAssetSnapshotValidationError.invalid(errors)
        }
    }
}

public enum ManualAssetSnapshotLoadResult: Equatable, Sendable {
    case missing
    case restored(ManualAssetSnapshot)
    case invalid
}

public enum ManualAssetSnapshotStorageError: Error, Equatable, Sendable {
    case invalidSnapshot
    case writeVerificationFailed
}

public struct ManualAssetSnapshotUserDefaultsStorage {
    public static let storageKey = "annual-rings.manual-asset-snapshot.v1"

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = Self.storageKey) {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> ManualAssetSnapshotLoadResult {
        guard let stored = defaults.object(forKey: key) else { return .missing }
        guard let data = stored as? Data,
              hasExactManualAssetSnapshotShape(data),
              let snapshot = try? JSONDecoder().decode(ManualAssetSnapshot.self, from: data),
              (try? snapshot.validate()) != nil else {
            defaults.removeObject(forKey: key)
            return .invalid
        }
        return .restored(snapshot)
    }

    public func save(_ snapshot: ManualAssetSnapshot) throws {
        guard (try? snapshot.validate()) != nil else {
            throw ManualAssetSnapshotStorageError.invalidSnapshot
        }
        let previousData: Data?
        if case .restored = load() {
            previousData = defaults.data(forKey: key)
        } else {
            previousData = nil
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard hasExactManualAssetSnapshotShape(data) else {
            throw ManualAssetSnapshotStorageError.invalidSnapshot
        }
        defaults.set(data, forKey: key)
        guard load() == .restored(snapshot) else {
            if let previousData {
                defaults.set(previousData, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
            throw ManualAssetSnapshotStorageError.writeVerificationFailed
        }
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }
}

private func manualAssetTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

private func manualAssetDate(_ value: String) -> Date? {
    guard value.hasSuffix("Z"), value.contains("T"), value.contains(".") else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value), manualAssetTimestamp(date) == value else { return nil }
    return date
}

private func hasExactManualAssetSnapshotShape(_ data: Data) -> Bool {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let positions = object["positions"] as? [[String: Any]] else { return false }
    let keys = Set(object.keys)
    let legacyKeys = Set([
        "schemaVersion", "source", "asOf", "savedAt", "positions", "cashStatus",
        "localOnly", "apiUploaded", "databaseWritten", "brokerSynced",
        "officialPortfolioFact", "productionFact"
    ])
    let provenanceKeys = Set(["ingress", "accountScope", "importActor", "reconciliationState"])
    guard keys == legacyKeys
        || keys == legacyKeys.union(provenanceKeys)
        || keys == legacyKeys.union(provenanceKeys).union(["sourceHash"]) else { return false }
    return positions.allSatisfy { position in
        let keys = Set(position.keys)
        return keys == Set(["symbol", "quantity", "currency"])
            || keys == Set(["symbol", "quantity", "marketValue", "currency"])
    }
}
