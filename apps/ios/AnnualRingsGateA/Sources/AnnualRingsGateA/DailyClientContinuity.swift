import Foundation

public let DAILY_CLIENT_RESUME_SCHEMA_VERSION = "2026-07-18.daily-client-resume.v1"

public enum DailyClientEntry: String, Codable, CaseIterable, Sendable {
    case quote
    case assistedDecision = "assisted_decision"
}

public enum DailyClientRingLayer: String, Codable, CaseIterable, Sendable {
    case candidate
    case evidence
    case portfolio
    case decision
    case review
}

public enum DailyClientResumeValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct DailyClientResumeSnapshot: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let canonicalSymbol: String
    public let selectedEntry: DailyClientEntry
    public let selectedLayer: DailyClientRingLayer
    public let savedAt: String
    public let navigationOnly: Bool
    public let persistsServerFacts: Bool
    public let persistsAuthorization: Bool

    public init(
        canonicalSymbol: String,
        selectedEntry: DailyClientEntry,
        selectedLayer: DailyClientRingLayer,
        savedAt: String,
        navigationOnly: Bool = true,
        persistsServerFacts: Bool = false,
        persistsAuthorization: Bool = false,
        schemaVersion: String = DAILY_CLIENT_RESUME_SCHEMA_VERSION
    ) {
        self.schemaVersion = schemaVersion
        self.canonicalSymbol = canonicalSymbol
        self.selectedEntry = selectedEntry
        self.selectedLayer = selectedLayer
        self.savedAt = savedAt
        self.navigationOnly = navigationOnly
        self.persistsServerFacts = persistsServerFacts
        self.persistsAuthorization = persistsAuthorization
    }

    public static func navigation(
        canonicalSymbol: String,
        selectedEntry: DailyClientEntry,
        selectedLayer: DailyClientRingLayer,
        savedAt: Date = Date()
    ) -> DailyClientResumeSnapshot {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return DailyClientResumeSnapshot(
            canonicalSymbol: canonicalSymbol,
            selectedEntry: selectedEntry,
            selectedLayer: selectedLayer,
            savedAt: formatter.string(from: savedAt)
        )
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != DAILY_CLIENT_RESUME_SCHEMA_VERSION {
            errors.append("resume schemaVersion is invalid")
        }
        if SecuritySymbol.parseHongKongAlias(canonicalSymbol)?.canonical != canonicalSymbol {
            errors.append("resume canonicalSymbol must be a canonical Hong Kong symbol")
        }
        if !isStrictUtcDateTime(savedAt) {
            errors.append("resume savedAt must be a strict UTC instant")
        }
        if !navigationOnly || persistsServerFacts || persistsAuthorization {
            errors.append("resume storage must contain navigation only and no server facts or authorization")
        }
        if !errors.isEmpty {
            throw DailyClientResumeValidationError.invalid(errors)
        }
    }
}

public enum DailyClientResumeLoadResult: Equatable, Sendable {
    case missing
    case restored(DailyClientResumeSnapshot)
    case invalid

    public var snapshot: DailyClientResumeSnapshot? {
        guard case .restored(let snapshot) = self else { return nil }
        return snapshot
    }
}

public enum DailyClientResumeStorageError: Error, Equatable, Sendable {
    case invalidSnapshot
    case writeVerificationFailed
}

public struct DailyClientResumeUserDefaultsStorage {
    public static let storageKey = "annual-rings.daily-client-resume.v1"

    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = Self.storageKey) {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> DailyClientResumeLoadResult {
        guard let stored = defaults.object(forKey: key) else { return .missing }
        guard let data = stored as? Data,
              hasExactResumeShape(data),
              let snapshot = try? JSONDecoder().decode(DailyClientResumeSnapshot.self, from: data),
              (try? snapshot.validate()) != nil else {
            defaults.removeObject(forKey: key)
            return .invalid
        }
        return .restored(snapshot)
    }

    public func save(_ snapshot: DailyClientResumeSnapshot) throws {
        guard (try? snapshot.validate()) != nil else {
            throw DailyClientResumeStorageError.invalidSnapshot
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard hasExactResumeShape(data) else {
            throw DailyClientResumeStorageError.invalidSnapshot
        }
        defaults.set(data, forKey: key)
        guard load() == .restored(snapshot) else {
            throw DailyClientResumeStorageError.writeVerificationFailed
        }
    }

    public func clear() {
        defaults.removeObject(forKey: key)
    }
}

public struct DailyClientSourceKey: Equatable, Sendable {
    public let canonicalSymbol: String
    public let authorizationRevision: UUID

    public init?(canonicalSymbol: String, authorizationRevision: UUID) {
        guard SecuritySymbol.parseHongKongAlias(canonicalSymbol)?.canonical == canonicalSymbol else {
            return nil
        }
        self.canonicalSymbol = canonicalSymbol
        self.authorizationRevision = authorizationRevision
    }
}

public struct DailyClientRefreshTicket: Equatable, Sendable {
    public let requestId: UUID
    public let source: DailyClientSourceKey
}

public enum DailyClientRefreshPhase: String, Equatable, Sendable {
    case idle
    case validatingRestoredNavigation = "validating_restored_navigation"
    case refreshing
    case checked
    case limited
    case superseded
}

public struct DailyClientRefreshGate: Equatable, Sendable {
    public private(set) var currentRequestId = UUID()
    public private(set) var currentSource: DailyClientSourceKey?
    public private(set) var phase = DailyClientRefreshPhase.idle

    public init() {}

    public mutating func begin(
        source: DailyClientSourceKey,
        restoredNavigation: Bool,
        requestId: UUID = UUID()
    ) -> DailyClientRefreshTicket {
        currentRequestId = requestId
        currentSource = source
        phase = restoredNavigation ? .validatingRestoredNavigation : .refreshing
        return DailyClientRefreshTicket(requestId: requestId, source: source)
    }

    public func isCurrent(_ ticket: DailyClientRefreshTicket, source: DailyClientSourceKey) -> Bool {
        currentRequestId == ticket.requestId && currentSource == source && ticket.source == source
    }

    public mutating func finish(
        _ ticket: DailyClientRefreshTicket,
        source: DailyClientSourceKey,
        limited: Bool
    ) {
        guard isCurrent(ticket, source: source) else { return }
        phase = limited ? .limited : .checked
    }

    public mutating func supersede(requestId: UUID = UUID()) {
        currentRequestId = requestId
        currentSource = nil
        phase = .superseded
    }
}

private func hasExactResumeShape(_ data: Data) -> Bool {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return false
    }
    return Set(object.keys) == Set([
        "schemaVersion",
        "canonicalSymbol",
        "selectedEntry",
        "selectedLayer",
        "savedAt",
        "navigationOnly",
        "persistsServerFacts",
        "persistsAuthorization"
    ])
}
