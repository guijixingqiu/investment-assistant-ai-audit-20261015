import Foundation

public enum CandidateMembershipState: String, Codable, Equatable, CaseIterable, Sendable {
    case tracked
    case paused
    case archived
}

public enum CandidateMembershipEnvelopeStatus: String, Codable, Equatable, Sendable {
    case available
    case empty
    case unavailable
}

public enum CandidateMembershipResearchStatus: String, Codable, Equatable, Sendable {
    case available
    case missing
}

public enum CandidateMembershipQuoteStatus: String, Codable, Equatable, Sendable {
    case fresh
    case stale
    case unavailable
}

public enum CandidateMembershipWriteResult: String, Codable, Equatable, Sendable {
    case created
    case alreadyExists = "already_exists"
    case restored
    case stateChanged = "state_changed"
    case unchanged
}

public enum CandidateMembershipInitialState: String, Codable, Equatable, CaseIterable, Sendable {
    case tracked
    case paused
}

public enum CandidateMembershipValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct CandidateMembershipEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-03.core-1d.candidate-membership.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let metadata: FactMetadata
    public let status: CandidateMembershipEnvelopeStatus
    public let includeArchived: Bool
    public let message: String
    public let provenance: CandidateMembershipEnvelopeProvenance
    public let memberships: [CandidateMembershipData]

    public static func unavailable(_ message: String, includeArchived: Bool = true) -> CandidateMembershipEnvelope {
        let generatedAt = ISO8601DateFormatter().string(from: Date())
        return CandidateMembershipEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: generatedAt,
            metadata: FactMetadata(
                source: "candidate_memberships",
                asOf: generatedAt,
                fetchedAt: generatedAt,
                freshness: "unavailable",
                provenance: "unavailable",
                authority: "unavailable",
                stale: false,
                missing: true,
                conflict: false,
                fixture: false,
                correctionOf: nil,
                replaces: nil,
                message: message
            ),
            status: .unavailable,
            includeArchived: includeArchived,
            message: message,
            provenance: CandidateMembershipEnvelopeProvenance(
                memberships: "candidate_memberships",
                research: "research_profiles_optional",
                quotes: "persisted_market_quotes_optional",
                portfolio: "omitted"
            ),
            memberships: []
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("schemaVersion must be \(Self.schemaVersionV1)")
        }
        if !isCandidateMembershipDateTime(generatedAt) {
            errors.append("generatedAt must be a valid ISO timestamp")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        metadata.validateForDisplay(label: "candidate membership", errors: &errors)
        if metadata.provenance != "real" && metadata.provenance != "unavailable" {
            errors.append("candidate membership metadata.provenance must be real or unavailable")
        }
        if metadata.authority != "candidate_membership" && metadata.authority != "unavailable" {
            errors.append("candidate membership metadata.authority must be candidate_membership or unavailable")
        }
        provenance.validate(errors: &errors)
        switch status {
        case .available:
            if memberships.isEmpty {
                errors.append("available status requires at least one membership")
            }
            if metadata.freshness != "fresh" {
                errors.append("available status requires fresh metadata")
            }
        case .empty, .unavailable:
            if !memberships.isEmpty {
                errors.append("\(status.rawValue) status requires zero memberships")
            }
            if status == .empty && metadata.freshness != "missing" {
                errors.append("empty status requires missing metadata")
            }
            if status == .unavailable && metadata.freshness == "fresh" {
                errors.append("unavailable status must not carry fresh metadata")
            }
        }

        var identities = Set<String>()
        var previous: CandidateMembershipData?
        for membership in memberships {
            membership.validate(errors: &errors)
            let key = "\(membership.actorId):\(membership.market):\(membership.code)"
            if identities.contains(key) {
                errors.append("memberships must contain one logical membership per actor and symbol")
            }
            identities.insert(key)
            if let previous,
               CandidateMembershipData.compareDisplayOrder(previous, membership) > 0 {
                errors.append("memberships must preserve contract order")
            }
            previous = membership
        }

        if !errors.isEmpty {
            throw CandidateMembershipValidationError.invalid(errors)
        }
    }
}

public struct CandidateMembershipEnvelopeProvenance: Codable, Equatable, Sendable {
    public let memberships: String
    public let research: String
    public let quotes: String
    public let portfolio: String

    func validate(errors: inout [String]) {
        if memberships != "candidate_memberships" ||
            research != "research_profiles_optional" ||
            quotes != "persisted_market_quotes_optional" ||
            portfolio != "omitted" {
            errors.append("membership envelope provenance is invalid")
        }
    }
}

public struct CandidateMembershipData: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let actorId: String
    public let market: String
    public let code: String
    public let symbol: String
    public let state: CandidateMembershipState
    public let version: Int
    public let createdAt: String
    public let updatedAt: String
    public let archivedAt: String?
    public let provenance: CandidateMembershipProvenance
    public let research: CandidateMembershipResearchState
    public let quote: CandidateMembershipQuoteState
    public let safety: CandidateMembershipSafety

    private enum CodingKeys: String, CodingKey {
        case id
        case actorId
        case market
        case code
        case symbol
        case state
        case version
        case createdAt
        case updatedAt
        case archivedAt
        case provenance
        case research
        case quote
        case safety
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        actorId = try container.decode(String.self, forKey: .actorId)
        market = try container.decode(String.self, forKey: .market)
        code = try container.decode(String.self, forKey: .code)
        symbol = try container.decode(String.self, forKey: .symbol)
        state = try container.decode(CandidateMembershipState.self, forKey: .state)
        version = try container.decode(Int.self, forKey: .version)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        archivedAt = try container.decodeRequiredNullable(String.self, forKey: .archivedAt)
        provenance = try container.decode(CandidateMembershipProvenance.self, forKey: .provenance)
        research = try container.decode(CandidateMembershipResearchState.self, forKey: .research)
        quote = try container.decode(CandidateMembershipQuoteState.self, forKey: .quote)
        safety = try container.decode(CandidateMembershipSafety.self, forKey: .safety)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(actorId, forKey: .actorId)
        try container.encode(market, forKey: .market)
        try container.encode(code, forKey: .code)
        try container.encode(symbol, forKey: .symbol)
        try container.encode(state, forKey: .state)
        try container.encode(version, forKey: .version)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(archivedAt, forKey: .archivedAt)
        try container.encode(provenance, forKey: .provenance)
        try container.encode(research, forKey: .research)
        try container.encode(quote, forKey: .quote)
        try container.encode(safety, forKey: .safety)
    }

    func validate(errors: inout [String]) {
        if id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("membership.id is required")
        }
        if actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("membership.actorId is required")
        }
        if market != "HK" {
            errors.append("membership.market must be HK")
        }
        if code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil {
            errors.append("membership.code must be a five digit Hong Kong code")
        }
        if symbol != "\(market).\(code)" {
            errors.append("membership.symbol must equal market.code")
        }
        if version < 1 {
            errors.append("membership.version must be positive")
        }
        if !isCandidateMembershipDateTime(createdAt) {
            errors.append("membership.createdAt must be a valid ISO timestamp")
        }
        if !isCandidateMembershipDateTime(updatedAt) {
            errors.append("membership.updatedAt must be a valid ISO timestamp")
        }
        if state == .archived {
            if archivedAt == nil {
                errors.append("archived membership requires archivedAt")
            }
        } else if archivedAt != nil {
            errors.append("active membership must not carry archivedAt")
        }
        if let archivedAt, !isCandidateMembershipDateTime(archivedAt) {
            errors.append("membership.archivedAt must be a valid ISO timestamp")
        }
        provenance.validate(research: research, quote: quote, errors: &errors)
        research.validate(errors: &errors)
        quote.validate(errors: &errors)
        safety.validate(errors: &errors)
    }

    fileprivate static func compareDisplayOrder(_ left: CandidateMembershipData, _ right: CandidateMembershipData) -> Int {
        let stateOrder: [CandidateMembershipState: Int] = [.tracked: 0, .paused: 1, .archived: 2]
        let stateComparison = (stateOrder[left.state] ?? 99) - (stateOrder[right.state] ?? 99)
        if stateComparison != 0 { return stateComparison }
        let updatedComparison = right.updatedAt.compare(left.updatedAt).rawValue
        if updatedComparison != 0 { return updatedComparison }
        return left.symbol.compare(right.symbol).rawValue
    }
}

public struct CandidateMembershipProvenance: Codable, Equatable, Sendable {
    public let membership: String
    public let research: String
    public let quotes: String
    public let portfolio: String

    fileprivate func validate(research researchState: CandidateMembershipResearchState, quote: CandidateMembershipQuoteState, errors: inout [String]) {
        if membership != "candidate_memberships" || portfolio != "omitted" {
            errors.append("membership provenance source is invalid")
        }
        if research != "research_profiles" && research != "missing" {
            errors.append("membership research provenance is invalid")
        }
        if quotes != "persisted_market_quotes" && quotes != "unavailable" {
            errors.append("membership quote provenance is invalid")
        }
        if research == "research_profiles" && researchState.status != .available {
            errors.append("research provenance requires available research")
        }
        if research == "missing" && researchState.status != .missing {
            errors.append("missing research provenance requires missing research state")
        }
        if quotes == "persisted_market_quotes" && quote.status == .unavailable {
            errors.append("persisted quote provenance requires a persisted quote state")
        }
        if quotes == "unavailable" && quote.status != .unavailable {
            errors.append("unavailable quote provenance requires unavailable quote state")
        }
    }
}

public struct CandidateMembershipResearchState: Codable, Equatable, Sendable {
    public let status: CandidateMembershipResearchStatus
    public let profileUpdatedAt: String?
    public let name: String?

    private enum CodingKeys: String, CodingKey {
        case status
        case profileUpdatedAt
        case name
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(CandidateMembershipResearchStatus.self, forKey: .status)
        profileUpdatedAt = try container.decodeRequiredNullable(String.self, forKey: .profileUpdatedAt)
        name = try container.decodeRequiredNullable(String.self, forKey: .name)
    }

    fileprivate func validate(errors: inout [String]) {
        if status == .available {
            if profileUpdatedAt == nil {
                errors.append("available research requires profileUpdatedAt")
            }
        } else if profileUpdatedAt != nil {
            errors.append("missing research must not carry profileUpdatedAt")
        }
        if let profileUpdatedAt, !isCandidateMembershipDateTime(profileUpdatedAt) {
            errors.append("research.profileUpdatedAt must be a valid ISO timestamp")
        }
        if let name, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research.name must be non-empty when present")
        }
    }
}

public struct CandidateMembershipQuoteState: Codable, Equatable, Sendable {
    public let status: CandidateMembershipQuoteStatus
    public let source: String?
    public let fetchedAt: String?
    public let staleReason: String?

    private enum CodingKeys: String, CodingKey {
        case status
        case source
        case fetchedAt
        case staleReason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(CandidateMembershipQuoteStatus.self, forKey: .status)
        source = try container.decodeRequiredNullable(String.self, forKey: .source)
        fetchedAt = try container.decodeRequiredNullable(String.self, forKey: .fetchedAt)
        staleReason = try container.decodeRequiredNullable(String.self, forKey: .staleReason)
    }

    fileprivate func validate(errors: inout [String]) {
        if let source, source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("quote.source must be non-empty when present")
        }
        if let fetchedAt, !isCandidateMembershipDateTime(fetchedAt) {
            errors.append("quote.fetchedAt must be a valid ISO timestamp")
        }
        let allowedReasons = ["quote_time_exceeds_live_max_age", "no_persisted_quote", "repository_error"]
        if let staleReason, !allowedReasons.contains(staleReason) {
            errors.append("quote.staleReason is invalid")
        }
        switch status {
        case .fresh:
            if source == nil || fetchedAt == nil || staleReason != nil {
                errors.append("fresh quote requires source and fetchedAt without staleReason")
            }
        case .stale:
            if source == nil || fetchedAt == nil || staleReason != "quote_time_exceeds_live_max_age" {
                errors.append("stale quote requires persisted quote time and quote_time_exceeds_live_max_age")
            }
        case .unavailable:
            if source != nil || fetchedAt != nil || staleReason == nil {
                errors.append("unavailable quote requires no source, no fetchedAt, and a staleReason")
            }
        }
    }
}

public struct CandidateMembershipSafety: Codable, Equatable, Sendable {
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool

    fileprivate func validate(errors: inout [String]) {
        if createsOrder || createsTrade || mutatesCash || writesFee || mutatesPosition || callsBroker {
            errors.append("candidate membership safety flags must all be false")
        }
    }
}

public struct CreateCandidateMembershipRequest: Encodable, Equatable, Sendable {
    public let market: String
    public let code: String
    public let initialState: CandidateMembershipInitialState
    public let restoreArchived: Bool
    public let idempotencyKey: String

    public init(market: String, code: String, initialState: CandidateMembershipInitialState, restoreArchived: Bool, idempotencyKey: String) {
        self.market = market
        self.code = code
        self.initialState = initialState
        self.restoreArchived = restoreArchived
        self.idempotencyKey = idempotencyKey
    }
}

public struct UpdateCandidateMembershipStateRequest: Encodable, Equatable, Sendable {
    public let state: CandidateMembershipState
    public let version: Int
    public let idempotencyKey: String
}

public struct CandidateMembershipWriteEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let result: CandidateMembershipWriteResult
    public let auditEventId: String
    public let asOf: String
    public let source: CandidateMembershipWriteSource
    public let data: CandidateMembershipData
    public let message: String

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != CandidateMembershipEnvelope.schemaVersionV1 {
            errors.append("schemaVersion must be \(CandidateMembershipEnvelope.schemaVersionV1)")
        }
        if auditEventId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("auditEventId is required")
        }
        if !isCandidateMembershipDateTime(asOf) {
            errors.append("asOf must be a valid ISO timestamp")
        }
        source.validate(errors: &errors)
        data.validate(errors: &errors)
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("message is required")
        }
        if !errors.isEmpty {
            throw CandidateMembershipValidationError.invalid(errors)
        }
    }
}

public struct CandidateMembershipWriteSource: Codable, Equatable, Sendable {
    public let actorType: String
    public let actorId: String
    public let correlationId: String

    fileprivate func validate(errors: inout [String]) {
        if actorType != "user" && actorType != "system" {
            errors.append("source.actorType is invalid")
        }
        if actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("source.actorId is required")
        }
        if correlationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("source.correlationId is required")
        }
    }
}

public struct CandidateMembershipSubmissionFingerprint: Equatable, Sendable {
    public let operation: String
    public let membershipId: String?
    public let code: String?
    public let currentVersion: Int?
    public let targetState: CandidateMembershipState
    public let restoreArchived: Bool
}

public struct PendingCandidateMembershipSubmission: Equatable, Sendable {
    public let idempotencyKey: String
    public let fingerprint: CandidateMembershipSubmissionFingerprint
}

public struct CandidateMembershipSubmissionState {
    private var pending: PendingCandidateMembershipSubmission?
    private var inFlight = false
    private let makeIdempotencyKey: () -> String

    public init(makeIdempotencyKey: @escaping () -> String = { UUID().uuidString }) {
        self.makeIdempotencyKey = makeIdempotencyKey
    }

    public var isInFlight: Bool {
        inFlight
    }

    public mutating func begin(fingerprint: CandidateMembershipSubmissionFingerprint) -> PendingCandidateMembershipSubmission? {
        if inFlight { return nil }
        if let pending, pending.fingerprint == fingerprint {
            inFlight = true
            return pending
        }
        let next = PendingCandidateMembershipSubmission(
            idempotencyKey: makeIdempotencyKey(),
            fingerprint: fingerprint
        )
        pending = next
        inFlight = true
        return next
    }

    public mutating func finishSuccessOrReplay() {
        inFlight = false
        pending = nil
    }

    public mutating func finishFailurePreservingRetry() {
        inFlight = false
    }
}

public enum CandidateMembershipWriteOperation: Equatable, Sendable {
    case create
    case update
}

public enum CandidateMembershipWriteFailureState: String, Equatable, Sendable {
    case malformed
    case unauthorized
    case notFound = "not_found"
    case conflict
    case unavailable
    case semanticInvalid = "semantic-invalid"
    case decodingInvalid = "decoding-invalid"
    case offline
}

public struct CandidateMembershipWriteFailurePresentation: Equatable, Sendable {
    public let state: CandidateMembershipWriteFailureState
    public let message: String
    public let usesStaleMessage: Bool
    public let refreshesMemberships: Bool
}

public func candidateMembershipWriteFailurePresentation(
    for error: Error,
    operation: CandidateMembershipWriteOperation
) -> CandidateMembershipWriteFailurePresentation {
    if case ResearchClientError.httpStatus(let status) = error {
        switch status {
        case 400:
            return CandidateMembershipWriteFailurePresentation(
                state: .malformed,
                message: "写入状态 malformed：研究自选写入请求无效，已阻止提交 malformed payload；不会显示旧成功。",
                usesStaleMessage: false,
                refreshesMemberships: false
            )
        case 401:
            return CandidateMembershipWriteFailurePresentation(
                state: .unauthorized,
                message: "写入状态 unauthorized：需要写入授权后管理研究自选；不会伪装成空成功。",
                usesStaleMessage: false,
                refreshesMemberships: false
            )
        case 404:
            return CandidateMembershipWriteFailurePresentation(
                state: .notFound,
                message: "写入状态 not_found：研究自选成员不存在或已变更；已阻止旧状态复用。",
                usesStaleMessage: false,
                refreshesMemberships: true
            )
        case 409:
            let message = operation == .create
                ? "写入状态 conflict：已存在归档成员或幂等键冲突；如需恢复，请打开显式恢复并刷新后重试。"
                : "写入状态 conflict：成员版本已过期或幂等键冲突；已刷新最新状态，请确认后再写入。"
            return CandidateMembershipWriteFailurePresentation(
                state: .conflict,
                message: message,
                usesStaleMessage: true,
                refreshesMemberships: true
            )
        case 500...599:
            return CandidateMembershipWriteFailurePresentation(
                state: .unavailable,
                message: "写入状态 unavailable：研究自选写入仓库不可用；保留同一 idempotency key 以便同一请求安全重试。",
                usesStaleMessage: false,
                refreshesMemberships: false
            )
        default:
            return CandidateMembershipWriteFailurePresentation(
                state: .unavailable,
                message: "写入状态 unavailable：研究自选写入返回 HTTP \(status)，未更新本地成功状态。",
                usesStaleMessage: false,
                refreshesMemberships: false
            )
        }
    }

    if error is DecodingError {
        return CandidateMembershipWriteFailurePresentation(
            state: .decodingInvalid,
            message: "写入状态 decoding-invalid：写入响应格式无效，已阻止更新本地状态；保留 idempotency key 以便重试。",
            usesStaleMessage: false,
            refreshesMemberships: true
        )
    }

    if case CandidateMembershipValidationError.invalid = error {
        return CandidateMembershipWriteFailurePresentation(
            state: .semanticInvalid,
            message: "写入状态 semantic-invalid：写入响应语义无效，已阻止更新本地状态；保留 idempotency key 以便重试。",
            usesStaleMessage: false,
            refreshesMemberships: true
        )
    }

    return CandidateMembershipWriteFailurePresentation(
        state: .offline,
        message: "写入状态 offline：网络或本地请求失败，只保留本机重试能力，不显示网络成功或官方记录。",
        usesStaleMessage: false,
        refreshesMemberships: false
    )
}

/// Device-local, Owner-chosen research priority. It only reorders the existing
/// membership list inside its lifecycle group; it is not a shared investment
/// fact, not evidence sufficiency, and it never changes server-owned state.
public enum CandidateResearchPriority: String, CaseIterable, Equatable, Sendable {
    case priority
    case normal
    case later

    public var sortRank: Int {
        switch self {
        case .priority: 0
        case .normal: 1
        case .later: 2
        }
    }
}

/// Local-only persistence for `CandidateResearchPriority`. The stored value is
/// one JSON map scoped by `actorId|symbol`, so choices never leak across actors
/// or symbols, and reading a list never resets an unchosen symbol.
public enum CandidateResearchPriorityPreferences {
    public static let defaultsKey = "annualRings.candidateResearchPriority.v1"
    public static let lifecycleOrder: [CandidateMembershipState] = [.tracked, .paused, .archived]

    public static func storageKey(actorId: String, symbol: String) -> String {
        "\(actorId)|\(symbol)"
    }

    public static func decode(_ raw: String) -> [String: CandidateResearchPriority] {
        guard !raw.isEmpty,
              let data = raw.data(using: .utf8),
              let stored = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        var priorities: [String: CandidateResearchPriority] = [:]
        for (key, value) in stored {
            if let priority = CandidateResearchPriority(rawValue: value) {
                priorities[key] = priority
            }
        }
        return priorities
    }

    public static func encode(_ priorities: [String: CandidateResearchPriority]) -> String {
        guard !priorities.isEmpty else { return "" }
        let stored = priorities.mapValues(\.rawValue)
        guard let data = try? JSONEncoder().encode(stored),
              let raw = String(data: data, encoding: .utf8) else { return "" }
        return raw
    }

    public static func priority(
        actorId: String,
        symbol: String,
        raw: String
    ) -> CandidateResearchPriority {
        guard !actorId.isEmpty, !symbol.isEmpty else { return .normal }
        return decode(raw)[storageKey(actorId: actorId, symbol: symbol)] ?? .normal
    }

    public static func setting(
        _ priority: CandidateResearchPriority,
        actorId: String,
        symbol: String,
        raw: String
    ) -> String {
        guard !actorId.isEmpty, !symbol.isEmpty else { return raw }
        var priorities = decode(raw)
        priorities[storageKey(actorId: actorId, symbol: symbol)] = priority
        return encode(priorities)
    }

    /// Keeps the server lifecycle grouping (tracked, paused, archived); inside a
    /// group the local priority wins and equal priorities keep the server order.
    /// Paused and archived members are reordered only; they never become tracked.
    public static func sortedForDisplay(
        _ memberships: [CandidateMembershipData],
        raw: String
    ) -> [CandidateMembershipData] {
        let priorities = decode(raw)
        var ordered: [CandidateMembershipData] = []
        for state in lifecycleOrder {
            let group = memberships.enumerated().filter { $0.element.state == state }
            let ranked = group.sorted { left, right in
                let leftRank = sortRank(of: left.element, priorities: priorities)
                let rightRank = sortRank(of: right.element, priorities: priorities)
                if leftRank != rightRank { return leftRank < rightRank }
                return left.offset < right.offset
            }
            ordered.append(contentsOf: ranked.map { $0.element })
        }
        return ordered
    }

    private static func sortRank(
        of membership: CandidateMembershipData,
        priorities: [String: CandidateResearchPriority]
    ) -> Int {
        let key = storageKey(actorId: membership.actorId, symbol: membership.symbol)
        return (priorities[key] ?? .normal).sortRank
    }
}

private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Required nullable key '\(key.stringValue)' is missing"
                )
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}

private func isCandidateMembershipDateTime(_ value: String) -> Bool {
    Date.parseIso8601(value) != nil
}

private extension Date {
    static func parseIso8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}
