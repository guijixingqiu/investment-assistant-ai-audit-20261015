import Foundation

public let researchTemporaryConversationRetentionDefaultsKey =
    "researchTemporaryConversationRetention.v1"
public let researchTemporaryConversationClearMarkerDefaultsKey =
    "researchTemporaryConversationsCleared.v1"
public let researchTemporaryConversationDidClearNotification =
    Notification.Name("researchTemporaryConversationsDidClear")

public enum ResearchTemporaryConversationRetention: String, CaseIterable, Sendable {
    case sevenDays = "7_days"
    case thirtyDays = "30_days"
    case none

    public var title: String {
        switch self {
        case .sevenDays: "7 天"
        case .thirtyDays: "30 天"
        case .none: "不保留"
        }
    }

    var interval: TimeInterval? {
        switch self {
        case .sevenDays: 7 * 24 * 60 * 60
        case .thirtyDays: 30 * 24 * 60 * 60
        case .none: nil
        }
    }
}

public struct ResearchTemporaryConversationSnapshot: Equatable, Sendable {
    public let sessionId: String
    public let carrySummary: String?
    public let carryFromSessionId: String?
    public let responses: [ResearchEvidenceQuestionEnvelope]
    public let questionDraft: String
    public let correctionDraft: String
    public let savedAt: String
    public let expiresAt: String

    public init(responses: [ResearchEvidenceQuestionEnvelope], questionDraft: String,
                correctionDraft: String, savedAt: String, expiresAt: String,
                sessionId: String = "legacy", carrySummary: String? = nil,
                carryFromSessionId: String? = nil) {
        self.sessionId = sessionId
        self.carrySummary = carrySummary
        self.carryFromSessionId = carryFromSessionId
        self.responses = responses
        self.questionDraft = questionDraft
        self.correctionDraft = correctionDraft
        self.savedAt = savedAt
        self.expiresAt = expiresAt
    }
}

public enum ResearchTemporaryConversationStoreError: Error, Equatable, Sendable {
    case invalidRecord
    case readBackMismatch
}

private let researchTemporaryConversationStoreKey = "researchTemporaryConversations.v1"
private let researchTemporaryConversationSchemaVersion =
    "2026-08-17.research-temporary-conversation.v1"

private struct ResearchTemporaryConversationCollection: Codable {
    let schemaVersion: String
    var records: [ResearchTemporaryConversationRecord]
}

private struct ResearchTemporaryConversationRecord: Codable, Equatable {
    var sessionId: String? = nil
    var carrySummary: String? = nil
    var carryFromSessionId: String? = nil
    let actorId: String
    let membershipId: String
    let membershipVersion: Int
    let membershipState: String
    let symbol: String
    let reportId: String
    let reportVersion: Int
    let reportFingerprint: String
    let responses: [ResearchEvidenceQuestionEnvelope]
    let questionDraft: String
    let correctionDraft: String
    let savedAt: String
    let expiresAt: String

    func matches(_ membership: CandidateMembershipData, report: TwoLayerReportData) -> Bool {
        actorId == membership.actorId
            && membershipId == membership.id
            && membershipVersion == membership.version
            && membershipState == membership.state.rawValue
            && symbol == membership.symbol
            && reportId == report.id
            && reportVersion == report.version
            && reportFingerprint == report.reportFingerprint
    }
    var effectiveSessionId: String { sessionId ?? "legacy" }
}

public func researchTemporaryConversationRetention(
    defaults: UserDefaults = .standard
) -> ResearchTemporaryConversationRetention {
    ResearchTemporaryConversationRetention(
        rawValue: defaults.string(forKey: researchTemporaryConversationRetentionDefaultsKey) ?? ""
    ) ?? .thirtyDays
}

public func saveResearchTemporaryConversation(
    membership: CandidateMembershipData,
    report: TwoLayerReportData,
    responses: [ResearchEvidenceQuestionEnvelope],
    questionDraft: String,
    correctionDraft: String,
    retention: ResearchTemporaryConversationRetention,
    sessionId: String = "legacy",
    carrySummary: String? = nil,
    carryFromSessionId: String? = nil,
    now: Date = Date(),
    defaults: UserDefaults = .standard
) throws {
    guard let interval = retention.interval else {
        guard clearAllLocalTemporaryResearch(defaults: defaults, announce: false) else {
            throw ResearchTemporaryConversationStoreError.readBackMismatch
        }
        return
    }
    let boundedResponses = responses
    let questionDraft = questionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    let correctionDraft = correctionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard validResearchConversationSessionId(sessionId), boundedResponses.count <= 8,
          validResearchCarrySummary(carrySummary, sourceSessionId: carryFromSessionId),
          questionDraft.count <= 4_000, correctionDraft.count <= 4_000,
          !boundedResponses.isEmpty || !questionDraft.isEmpty || !correctionDraft.isEmpty
            || carrySummary != nil else {
        throw ResearchTemporaryConversationStoreError.invalidRecord
    }
    for response in boundedResponses {
        try response.validateForDisplay(
            expectedMembership: membership,
            expectedReport: report,
            expectedQuestion: response.question
        )
        guard response.status == "available" else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    let formatter = ISO8601DateFormatter()
    let record = ResearchTemporaryConversationRecord(
        sessionId: sessionId == "legacy" ? nil : sessionId,
        carrySummary: carrySummary,
        carryFromSessionId: carryFromSessionId,
        actorId: membership.actorId,
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state.rawValue,
        symbol: membership.symbol,
        reportId: report.id,
        reportVersion: report.version,
        reportFingerprint: report.reportFingerprint,
        responses: boundedResponses,
        questionDraft: questionDraft,
        correctionDraft: correctionDraft,
        savedAt: formatter.string(from: now),
        expiresAt: formatter.string(from: now.addingTimeInterval(interval))
    )
    var collection = try readResearchTemporaryConversationCollection(defaults: defaults)
    let retainedForReport = try collection.records.filter {
        try validatedResearchTemporaryConversationRecord($0, now: now)
            && $0.matches(membership, report: report)
    }
    if let existing = retainedForReport.last(where: { $0.effectiveSessionId == sessionId }) {
        // Saving an older page must not move its session behind a newer one.
        guard retainedForReport.last?.effectiveSessionId == sessionId else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
        guard existing.responses.count <= boundedResponses.count,
              Array(boundedResponses.prefix(existing.responses.count)) == existing.responses else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    } else if let active = retainedForReport.last {
        guard carrySummary != nil, carryFromSessionId == active.effectiveSessionId else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    collection.records = try collection.records.filter {
        try validatedResearchTemporaryConversationRecord($0, now: now)
            && !($0.matches(membership, report: report) && $0.effectiveSessionId == sessionId)
    }
    if let carryFromSessionId {
        let source = try readResearchTemporaryConversationCollection(defaults: defaults).records.first {
            try validatedResearchTemporaryConversationRecord($0, now: now)
                && $0.matches(membership, report: report)
                && $0.effectiveSessionId == carryFromSessionId
                && !$0.responses.isEmpty
        }
        let existing = try readResearchTemporaryConversationCollection(defaults: defaults).records.first {
            try validatedResearchTemporaryConversationRecord($0, now: now)
                && $0.matches(membership, report: report)
                && $0.effectiveSessionId == sessionId
                && $0.carrySummary == carrySummary
                && $0.carryFromSessionId == carryFromSessionId
        }
        guard source != nil || existing != nil, carryFromSessionId != sessionId else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    collection.records.append(record)
    try writeResearchTemporaryConversationCollection(collection, defaults: defaults)
    let readBack = try loadResearchTemporaryConversation(
        membership: membership,
        report: report,
        sessionId: sessionId,
        now: now,
        defaults: defaults
    )
    guard readBack?.responses == boundedResponses,
          readBack?.sessionId == sessionId,
          readBack?.carrySummary == carrySummary,
          readBack?.carryFromSessionId == carryFromSessionId else {
        throw ResearchTemporaryConversationStoreError.readBackMismatch
    }
}

public func loadResearchTemporaryConversation(
    membership: CandidateMembershipData,
    report: TwoLayerReportData,
    sessionId: String? = nil,
    now: Date = Date(),
    defaults: UserDefaults = .standard,
    cleanupExpired: Bool = true
) throws -> ResearchTemporaryConversationSnapshot? {
    guard researchTemporaryConversationRetention(defaults: defaults) != .none else {
        if cleanupExpired && !clearAllLocalTemporaryResearch(defaults: defaults, announce: false) {
            throw ResearchTemporaryConversationStoreError.readBackMismatch
        }
        return nil
    }
    var collection = try readResearchTemporaryConversationCollection(defaults: defaults)
    let retained = try collection.records.filter {
        try validatedResearchTemporaryConversationRecord($0, now: now)
    }
    if cleanupExpired && retained.count != collection.records.count {
        collection.records = retained
        try writeResearchTemporaryConversationCollection(collection, defaults: defaults)
    }
    guard let record = retained.last(where: { $0.matches(membership, report: report)
        && (sessionId == nil || $0.effectiveSessionId == sessionId) }) else {
        return nil
    }
    for response in record.responses {
        try response.validateForDisplay(
            expectedMembership: membership,
            expectedReport: report,
            expectedQuestion: response.question
        )
        guard response.status == "available" else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    return ResearchTemporaryConversationSnapshot(
        responses: record.responses,
        questionDraft: record.questionDraft,
        correctionDraft: record.correctionDraft,
        savedAt: record.savedAt,
        expiresAt: record.expiresAt,
        sessionId: record.effectiveSessionId,
        carrySummary: record.carrySummary,
        carryFromSessionId: record.carryFromSessionId
    )
}

public func listResearchTemporaryConversations(
    membership: CandidateMembershipData, report: TwoLayerReportData,
    now: Date = Date(), defaults: UserDefaults = .standard
) throws -> [ResearchTemporaryConversationSnapshot] {
    guard researchTemporaryConversationRetention(defaults: defaults) != .none else { return [] }
    let collection = try readResearchTemporaryConversationCollection(defaults: defaults)
    return try collection.records.filter { record in
        try validatedResearchTemporaryConversationRecord(record, now: now)
            && record.matches(membership, report: report)
    }.reversed().compactMap { record in
        try loadResearchTemporaryConversation(membership: membership, report: report,
            sessionId: record.effectiveSessionId, now: now, defaults: defaults)
    }
}

public func restoreResearchTemporaryConversationSnapshot(
    membership: CandidateMembershipData,
    report: TwoLayerReportData,
    snapshot: ResearchTemporaryConversationSnapshot,
    now: Date = Date(),
    defaults: UserDefaults = .standard
) throws {
    guard researchTemporaryConversationRetention(defaults: defaults) != .none else {
        throw ResearchTemporaryConversationStoreError.invalidRecord
    }
    let formatter = ISO8601DateFormatter()
    guard validResearchConversationSessionId(snapshot.sessionId),
          validResearchCarrySummary(snapshot.carrySummary, sourceSessionId: snapshot.carryFromSessionId),
          snapshot.responses.count <= 8,
          snapshot.questionDraft.count <= 4_000,
          snapshot.correctionDraft.count <= 4_000,
          let savedAt = formatter.date(from: snapshot.savedAt),
          let expiresAt = formatter.date(from: snapshot.expiresAt),
          savedAt <= expiresAt, expiresAt > now,
          !snapshot.responses.isEmpty || !snapshot.questionDraft.isEmpty
            || !snapshot.correctionDraft.isEmpty || snapshot.carrySummary != nil else {
        throw ResearchTemporaryConversationStoreError.invalidRecord
    }
    for response in snapshot.responses {
        try response.validateForDisplay(
            expectedMembership: membership,
            expectedReport: report,
            expectedQuestion: response.question
        )
        guard response.status == "available" else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    let record = ResearchTemporaryConversationRecord(
        sessionId: snapshot.sessionId == "legacy" ? nil : snapshot.sessionId,
        carrySummary: snapshot.carrySummary,
        carryFromSessionId: snapshot.carryFromSessionId,
        actorId: membership.actorId,
        membershipId: membership.id,
        membershipVersion: membership.version,
        membershipState: membership.state.rawValue,
        symbol: membership.symbol,
        reportId: report.id,
        reportVersion: report.version,
        reportFingerprint: report.reportFingerprint,
        responses: snapshot.responses,
        questionDraft: snapshot.questionDraft,
        correctionDraft: snapshot.correctionDraft,
        savedAt: snapshot.savedAt,
        expiresAt: snapshot.expiresAt
    )
    let previous = defaults.data(forKey: researchTemporaryConversationStoreKey)
    do {
        var collection = try readResearchTemporaryConversationCollection(defaults: defaults)
        collection.records = try collection.records.filter {
            try validatedResearchTemporaryConversationRecord($0, now: now)
        }
        // Restoring an archived session must not replace the current local session.
        guard !collection.records.contains(where: { $0.matches(membership, report: report) }) else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
        collection.records.append(record)
        try writeResearchTemporaryConversationCollection(collection, defaults: defaults)
        guard try loadResearchTemporaryConversation(
            membership: membership,
            report: report,
            sessionId: snapshot.sessionId,
            now: now,
            defaults: defaults,
            cleanupExpired: false
        ) == snapshot else {
            throw ResearchTemporaryConversationStoreError.readBackMismatch
        }
    } catch {
        if let previous {
            defaults.set(previous, forKey: researchTemporaryConversationStoreKey)
        } else {
            defaults.removeObject(forKey: researchTemporaryConversationStoreKey)
        }
        guard defaults.data(forKey: researchTemporaryConversationStoreKey) == previous else {
            throw ResearchTemporaryConversationStoreError.readBackMismatch
        }
        throw error
    }
}

public func researchTemporaryConversationClearMarker(defaults: UserDefaults = .standard) -> String? {
    defaults.string(forKey: researchTemporaryConversationClearMarkerDefaultsKey)
}

public struct ResearchTemporaryClearObservation: Sendable {
    private var hasObserved = false
    private var marker: String?

    public init() {}

    public mutating func observe(_ nextMarker: String?) -> Bool {
        let changed = hasObserved && marker != nextMarker
        marker = nextMarker
        hasObserved = true
        return changed
    }
}

public func researchTemporaryConversationIdentity(
    membership: CandidateMembershipData,
    report: TwoLayerReportData
) -> String {
    [membership.actorId, membership.id, String(membership.version), membership.state.rawValue,
     membership.symbol, report.id, String(report.version), report.reportFingerprint]
        .joined(separator: "\u{0}")
}

public func canContinueResearchTemporaryConversation(
    _ responses: [ResearchEvidenceQuestionEnvelope],
    membership: CandidateMembershipData,
    report: TwoLayerReportData,
    recordedClearMarker: String?,
    defaults: UserDefaults = .standard
) -> Bool {
    guard recordedClearMarker == researchTemporaryConversationClearMarker(defaults: defaults) else {
        return false
    }
    return responses.allSatisfy { response in
        guard response.status == "available" else { return false }
        do {
            try response.validateForDisplay(
                expectedMembership: membership,
                expectedReport: report,
                expectedQuestion: response.question
            )
            return true
        } catch {
            return false
        }
    }
}

@discardableResult
public func clearAllLocalTemporaryResearch(
    defaults: UserDefaults = .standard,
    announce: Bool = true
) -> Bool {
    let prefixes = ["investigation-summary-v5:", "investigation-summary-v4:",
                    "investigation-history-v6:", "real-investigation-v4:"]
    let keys = defaults.dictionaryRepresentation().keys.filter { key in
        key == researchTemporaryConversationStoreKey || prefixes.contains(where: key.hasPrefix)
    }
    for key in keys { defaults.removeObject(forKey: key) }
    let marker = announce ? UUID().uuidString : nil
    if let marker { defaults.set(marker, forKey: researchTemporaryConversationClearMarkerDefaultsKey) }
    let cleared = keys.allSatisfy { defaults.object(forKey: $0) == nil }
        && (marker == nil || defaults.string(forKey: researchTemporaryConversationClearMarkerDefaultsKey) == marker)
    if cleared && announce {
        NotificationCenter.default.post(name: researchTemporaryConversationDidClearNotification,
                                        object: defaults)
    }
    return cleared
}

/// Report-only cleanup remains available to report deletion and single-report repair paths.
public func clearAllResearchTemporaryConversations(defaults: UserDefaults = .standard) {
    defaults.removeObject(forKey: researchTemporaryConversationStoreKey)
}

public func clearResearchTemporaryConversation(
    membership: CandidateMembershipData,
    report: TwoLayerReportData,
    defaults: UserDefaults = .standard
) throws {
    var collection = try readResearchTemporaryConversationCollection(defaults: defaults)
    collection.records.removeAll { $0.matches(membership, report: report) }
    try writeResearchTemporaryConversationCollection(collection, defaults: defaults)
    guard try readResearchTemporaryConversationCollection(defaults: defaults).records
        .contains(where: { $0.matches(membership, report: report) }) == false else {
        throw ResearchTemporaryConversationStoreError.readBackMismatch
    }
}

private func readResearchTemporaryConversationCollection(
    defaults: UserDefaults
) throws -> ResearchTemporaryConversationCollection {
    guard let data = defaults.data(forKey: researchTemporaryConversationStoreKey) else {
        return ResearchTemporaryConversationCollection(
            schemaVersion: researchTemporaryConversationSchemaVersion,
            records: []
        )
    }
    let collection = try JSONDecoder().decode(ResearchTemporaryConversationCollection.self, from: data)
    guard collection.schemaVersion == researchTemporaryConversationSchemaVersion else {
        throw ResearchTemporaryConversationStoreError.invalidRecord
    }
    return collection
}

private func writeResearchTemporaryConversationCollection(
    _ collection: ResearchTemporaryConversationCollection,
    defaults: UserDefaults
) throws {
    if collection.records.isEmpty {
        defaults.removeObject(forKey: researchTemporaryConversationStoreKey)
        return
    }
    defaults.set(try JSONEncoder().encode(collection), forKey: researchTemporaryConversationStoreKey)
}

private func validatedResearchTemporaryConversationRecord(
    _ record: ResearchTemporaryConversationRecord,
    now: Date
) throws -> Bool {
    let formatter = ISO8601DateFormatter()
    guard validResearchConversationSessionId(record.effectiveSessionId),
          validResearchCarrySummary(record.carrySummary, sourceSessionId: record.carryFromSessionId),
          !record.actorId.isEmpty,
          !record.membershipId.isEmpty,
          record.membershipVersion > 0,
          CandidateMembershipState(rawValue: record.membershipState) != nil,
          SecuritySymbol.parseHongKongAlias(record.symbol)?.canonical == record.symbol,
          !record.reportId.isEmpty,
          record.reportVersion > 0,
          researchDocumentIsSha256(record.reportFingerprint),
          record.responses.count <= 8,
          record.questionDraft.count <= 4_000,
          record.correctionDraft.count <= 4_000,
          let savedAt = formatter.date(from: record.savedAt),
          let expiresAt = formatter.date(from: record.expiresAt),
          savedAt <= expiresAt else {
        throw ResearchTemporaryConversationStoreError.invalidRecord
    }
    for response in record.responses {
        guard response.membershipId == record.membershipId,
              response.membershipVersion == record.membershipVersion,
              response.symbol == record.symbol,
              response.binding?.reportId == record.reportId,
              response.binding?.reportVersion == record.reportVersion,
              response.binding?.reportFingerprint == record.reportFingerprint else {
            throw ResearchTemporaryConversationStoreError.invalidRecord
        }
    }
    return expiresAt > now
}

private func validResearchConversationSessionId(_ value: String) -> Bool {
    value == "legacy" || UUID(uuidString: value) != nil
}

private func validResearchCarrySummary(_ text: String?, sourceSessionId: String?) -> Bool {
    if text == nil { return sourceSessionId == nil }
    guard let text, let sourceSessionId else { return false }
    return validResearchConversationSessionId(sourceSessionId)
        && researchEvidenceQuestionCarrySummaryIsBounded(text)
}
