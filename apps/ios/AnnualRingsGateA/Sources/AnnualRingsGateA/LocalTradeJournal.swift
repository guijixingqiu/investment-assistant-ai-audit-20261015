import Foundation

public let LOCAL_TRADE_JOURNAL_SCHEMA_VERSION = "2026-08-04.local-trade-journal.v1"

public enum LocalTradeJournalValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum LocalTradeSide: String, Codable, CaseIterable, Sendable {
    case buy
    case sell
}

public struct LocalTradeRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let symbol: String
    public let side: LocalTradeSide
    public let quantity: Double
    public let price: Double
    public let currency: String
    public let occurredAt: String
    public let recordedAt: String

    public var totalValue: Double { quantity * price }

    public init(
        id: String,
        symbol: String,
        side: LocalTradeSide,
        quantity: Double,
        price: Double,
        currency: String = "HKD",
        occurredAt: String,
        recordedAt: String
    ) throws {
        self.id = id
        self.symbol = symbol
        self.side = side
        self.quantity = quantity
        self.price = price
        self.currency = currency
        self.occurredAt = occurredAt
        self.recordedAt = recordedAt
        try validate()
    }

    public static func local(
        id: UUID = UUID(),
        symbol: String,
        side: LocalTradeSide,
        quantity: Double,
        price: Double,
        occurredAt: Date,
        recordedAt: Date = Date()
    ) throws -> LocalTradeRecord {
        try LocalTradeRecord(
            id: id.uuidString.lowercased(),
            symbol: symbol,
            side: side,
            quantity: quantity,
            price: price,
            occurredAt: localTradeTimestamp(occurredAt),
            recordedAt: localTradeTimestamp(recordedAt)
        )
    }

    public func validate() throws {
        var errors: [String] = []
        if UUID(uuidString: id)?.uuidString.lowercased() != id {
            errors.append("local trade id must be a canonical UUID")
        }
        if SecuritySymbol.parseHongKongAlias(symbol)?.canonical != symbol {
            errors.append("local trade requires a canonical Hong Kong symbol")
        }
        if !quantity.isFinite || quantity <= 0 || !price.isFinite || price <= 0 || !totalValue.isFinite {
            errors.append("local trade quantity, price, and total must be finite and positive")
        }
        if currency != "HKD" {
            errors.append("local trade currency must be HKD")
        }
        guard let occurred = localTradeDate(occurredAt), let recorded = localTradeDate(recordedAt) else {
            errors.append("local trade timestamps must be strict UTC instants")
            throw LocalTradeJournalValidationError.invalid(errors)
        }
        if occurred > recorded {
            errors.append("local trade cannot occur after it was recorded")
        }
        if !errors.isEmpty {
            throw LocalTradeJournalValidationError.invalid(errors)
        }
    }
}

public struct LocalTradeJournal: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let source: String
    public let records: [LocalTradeRecord]
    public let localOnly: Bool
    public let apiUploaded: Bool
    public let databaseWritten: Bool
    public let brokerSynced: Bool
    public let officialTradeFact: Bool
    public let officialPortfolioFact: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let createsOrder: Bool
    public let callsBroker: Bool
    public let productionFact: Bool

    public init(
        records: [LocalTradeRecord],
        schemaVersion: String = LOCAL_TRADE_JOURNAL_SCHEMA_VERSION,
        source: String = "owner_manual_local_trade",
        localOnly: Bool = true,
        apiUploaded: Bool = false,
        databaseWritten: Bool = false,
        brokerSynced: Bool = false,
        officialTradeFact: Bool = false,
        officialPortfolioFact: Bool = false,
        mutatesCash: Bool = false,
        writesFee: Bool = false,
        mutatesPosition: Bool = false,
        createsOrder: Bool = false,
        callsBroker: Bool = false,
        productionFact: Bool = false
    ) throws {
        self.schemaVersion = schemaVersion
        self.source = source
        self.records = records.sorted {
            ($0.occurredAt, $0.recordedAt, $0.id) > ($1.occurredAt, $1.recordedAt, $1.id)
        }
        self.localOnly = localOnly
        self.apiUploaded = apiUploaded
        self.databaseWritten = databaseWritten
        self.brokerSynced = brokerSynced
        self.officialTradeFact = officialTradeFact
        self.officialPortfolioFact = officialPortfolioFact
        self.mutatesCash = mutatesCash
        self.writesFee = writesFee
        self.mutatesPosition = mutatesPosition
        self.createsOrder = createsOrder
        self.callsBroker = callsBroker
        self.productionFact = productionFact
        try validate()
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != LOCAL_TRADE_JOURNAL_SCHEMA_VERSION || source != "owner_manual_local_trade" {
            errors.append("local trade journal identity is invalid")
        }
        if records.isEmpty || records.count > 200 || Set(records.map(\.id)).count != records.count {
            errors.append("local trade journal requires 1...200 unique records")
        }
        for record in records {
            do { try record.validate() } catch { errors.append("local trade record is invalid") }
        }
        if !localOnly || apiUploaded || databaseWritten || brokerSynced || officialTradeFact
            || officialPortfolioFact || mutatesCash || writesFee || mutatesPosition
            || createsOrder || callsBroker || productionFact {
            errors.append("local trade journal safety boundary is invalid")
        }
        if !errors.isEmpty {
            throw LocalTradeJournalValidationError.invalid(errors)
        }
    }
}

public enum LocalTradeJournalLoadResult: Equatable, Sendable {
    case missing
    case restored(LocalTradeJournal)
    case invalid
}

public enum LocalTradeJournalStorageError: Error, Equatable, Sendable {
    case invalidJournal
    case writeVerificationFailed
}

public struct LocalTradeJournalUserDefaultsStorage {
    public static let storageKey = "annual-rings.local-trade-journal.v1"

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = Self.storageKey) {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> LocalTradeJournalLoadResult {
        guard let stored = defaults.object(forKey: key) else { return .missing }
        guard let data = stored as? Data,
              hasExactLocalTradeJournalShape(data),
              let journal = try? JSONDecoder().decode(LocalTradeJournal.self, from: data),
              (try? journal.validate()) != nil else {
            defaults.removeObject(forKey: key)
            return .invalid
        }
        return .restored(journal)
    }

    public func save(_ journal: LocalTradeJournal) throws {
        guard (try? journal.validate()) != nil else {
            throw LocalTradeJournalStorageError.invalidJournal
        }
        let previousData: Data?
        if case .restored = load() {
            previousData = defaults.data(forKey: key)
        } else {
            previousData = nil
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(journal)
        guard hasExactLocalTradeJournalShape(data) else {
            throw LocalTradeJournalStorageError.invalidJournal
        }
        defaults.set(data, forKey: key)
        guard load() == .restored(journal) else {
            if let previousData {
                defaults.set(previousData, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
            throw LocalTradeJournalStorageError.writeVerificationFailed
        }
    }

    @discardableResult
    public func clear() -> Bool {
        defaults.removeObject(forKey: key)
        return defaults.object(forKey: key) == nil
    }
}

private func localTradeTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

private func localTradeDate(_ value: String) -> Date? {
    guard isStrictUtcDateTime(value) else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value), localTradeTimestamp(date) == value else { return nil }
    return date
}

private func hasExactLocalTradeJournalShape(_ data: Data) -> Bool {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let records = object["records"] as? [[String: Any]] else { return false }
    let expected = Set([
        "schemaVersion", "source", "records", "localOnly", "apiUploaded",
        "databaseWritten", "brokerSynced", "officialTradeFact", "officialPortfolioFact",
        "mutatesCash", "writesFee", "mutatesPosition", "createsOrder", "callsBroker",
        "productionFact"
    ])
    guard Set(object.keys) == expected else { return false }
    let recordKeys = Set(["id", "symbol", "side", "quantity", "price", "currency", "occurredAt", "recordedAt"])
    return records.allSatisfy { Set($0.keys) == recordKeys }
}
