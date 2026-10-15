import Foundation

public enum TodayActionInboxStatus: String, Codable, Equatable, Sendable {
    case available
    case empty
    case unavailable
    case unauthorized
}

public enum TodayActionInboxItemKind: String, Codable, Equatable, Sendable {
    case research
    case researchCompleted = "research_completed"
    case candidateFound = "candidate_found"
    case researchProfileReviewDue = "research_profile_review_due"
    case materialChange = "material_change"
    case marketAnomaly = "market_anomaly"
    case formalDecisionDue = "formal_decision_due"
    case reviewDue = "review_due"
    case dailyTracking = "daily_tracking"
    case sourceFailure = "source_failure"
}

public enum TodayActionInboxItemState: String, Codable, Equatable, Sendable {
    case new
    case later
    case resolved
    case expired
    case blocked
}

public struct TodayActionInboxMembershipRef: Codable, Equatable, Sendable {
    public let id: String
    public let version: Int
    public let symbol: String
}

public struct TodayActionInboxSourceRef: Codable, Equatable, Sendable {
    public let lane: String
    public let id: String
    public let version: Int?
    public let status: String
    public let sourceType: String
    public let effectiveAt: String?
    public let asOf: String?
    public let fetchedAt: String
    public let validUntil: String?
    public let freshness: String
    public let sourceFingerprint: String?
}

public struct TodayActionInboxResearchTarget: Codable, Equatable, Sendable {
    public struct Report: Codable, Equatable, Sendable {
        public let id: String
        public let version: Int
        public let evidencePackId: String
    }
    public let itemId: String
    public let preferredLayer: String
    public let report: Report?
    public let task: TodayActionInboxResearchTask?
}

public struct TodayActionInboxItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let order: Int
    public let kind: TodayActionInboxItemKind
    public let priority: String
    public let state: TodayActionInboxItemState
    public let symbol: String
    public let membership: TodayActionInboxMembershipRef
    public let source: TodayActionInboxSourceRef
    public let title: String
    public let summary: String
    public var versionChange: String? = nil
    public let researchTarget: TodayActionInboxResearchTarget?
    public let reviewEvent: TodayReviewDueEvent?
}

public struct TodayActionInboxEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionCurrent = "2026-08-08.today-action-inbox.v4"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: TodayActionInboxStatus
    public let requestedActorId: String
    public let metadata: FactMetadata
    public let trackedMembershipCount: Int
    public let omittedMembershipCount: Int
    public let items: [TodayActionInboxItem]
    public let omittedItemCount: Int
    public let message: String
    public let safety: TodayActionInboxSafety

    public static func unavailable(_ status: TodayActionInboxStatus = .unavailable, message: String) -> Self {
        let now = ISO8601DateFormatter().string(from: Date())
        return Self(
            schemaVersion: schemaVersionCurrent,
            generatedAt: now,
            status: status == .available || status == .empty ? .unavailable : status,
            requestedActorId: "UNKNOWN",
            metadata: FactMetadata(
                source: "today_action_inbox:unavailable", asOf: nil, fetchedAt: nil,
                freshness: "unavailable", provenance: "unavailable", authority: "unavailable",
                stale: false, missing: false, conflict: false, fixture: false,
                correctionOf: nil, replaces: nil, message: message
            ),
            trackedMembershipCount: 0,
            omittedMembershipCount: 0,
            items: [],
            omittedItemCount: 0,
            message: message,
            safety: .noSideEffects
        )
    }

    public func validateForDisplay(now: Date = Date()) throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionCurrent { errors.append("Today action inbox schemaVersion is invalid") }
        if parseInstant(generatedAt) == nil || parseInstant(generatedAt)! > now { errors.append("Today action inbox generatedAt is invalid") }
        if requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { errors.append("Today action inbox actor is required") }
        metadata.validateForDisplay(label: "Today action inbox", errors: &errors)
        if let asOf = metadata.asOf, parseInstant(asOf).map({ $0 > now }) == true { errors.append("Today action inbox metadata.asOf is in the future") }
        if let fetchedAt = metadata.fetchedAt, parseInstant(fetchedAt).map({ $0 > now }) == true { errors.append("Today action inbox metadata.fetchedAt is in the future") }
        let expectedFreshness = status == .available ? "fresh" : status == .empty ? "missing" : "unavailable"
        if metadata.freshness != expectedFreshness { errors.append("Today action inbox metadata freshness is invalid") }
        if status == .available || status == .empty {
            if metadata.source != "today_action_inbox" || !["real", "fixture"].contains(metadata.provenance) || metadata.authority != "research_evidence" || (metadata.provenance == "fixture") != metadata.fixture { errors.append("Today action inbox metadata identity is invalid") }
            if metadata.stale || metadata.conflict || (status == .available && metadata.missing) || (status == .empty && !metadata.missing) { errors.append("Today action inbox metadata state flags are invalid") }
        } else if metadata.provenance != "unavailable" || metadata.authority != "unavailable" {
            errors.append("Today action inbox fail-closed metadata is invalid")
        } else if metadata.stale || metadata.missing || metadata.conflict || metadata.fixture {
            errors.append("Today action inbox fail-closed metadata state flags are invalid")
        }
        if !(0...100).contains(trackedMembershipCount)
            || !(0...100).contains(omittedMembershipCount)
            || !(0...500).contains(omittedItemCount)
            || items.count > 100 {
            errors.append("Today action inbox bounds are invalid")
        }
        if status == .available && items.isEmpty { errors.append("available Today action inbox requires an item") }
        if status != .available && !items.isEmpty { errors.append("non-available Today action inbox must clear items") }
        var identities = Set<String>()
        var membershipIdentities = Set<String>()
        for (index, item) in items.enumerated() {
            item.validate(order: index + 1, now: now, errors: &errors)
            if identities.insert(item.id).inserted == false { errors.append("Today action inbox item id is duplicated") }
            membershipIdentities.insert(item.membership.id)
        }
        if trackedMembershipCount < membershipIdentities.count { errors.append("Today action inbox membership count is inconsistent") }
        safety.validate(errors: &errors)
        if !errors.isEmpty { throw TodayActionInboxValidationError.invalid(errors) }
    }
}

public struct TodayActionInboxSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool
    public static let noSideEffects = TodayActionInboxSafety(advisoryOnly: true, createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false, productionWrite: false)
    fileprivate func validate(errors: inout [String]) {
        if self != .noSideEffects { errors.append("Today action inbox safety boundary is invalid") }
    }
}
extension TodayActionInboxItem {
    fileprivate func validate(order expectedOrder: Int, now: Date, errors: inout [String]) {
        if order != expectedOrder || symbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) == nil || title.isEmpty || summary.isEmpty || versionChange.map({ $0.count > 4_000 || $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) == true { errors.append("Today action inbox item identity/copy is invalid") }
        if membership.symbol != symbol || membership.id.isEmpty || membership.version < 1 { errors.append("Today action inbox membership binding is invalid") }
        if !["action", "high", "medium", "low"].contains(priority)
            || !["research", "review_due", "candidate_membership", "research_material", "market_quote"].contains(source.lane)
            || source.id.isEmpty
            || source.status.isEmpty
            || source.sourceType.isEmpty
            || parseInstant(source.fetchedAt).map({ $0 > now }) != false
            || !["fresh", "stale", "missing", "unavailable"].contains(source.freshness)
            || (source.version != nil && source.version! < 1)
            || (kind != .sourceFailure && source.status != "available") {
            errors.append("Today action inbox priority/source is invalid")
        }
        for timestamp in [source.effectiveAt, source.asOf] {
            if let timestamp, parseInstant(timestamp).map({ $0 > now }) != false { errors.append("Today action inbox source chronology is invalid") }
        }
        if let validUntil = source.validUntil, parseInstant(validUntil) == nil {
            errors.append("Today action inbox source validUntil is invalid")
        }
        if let effectiveAt = source.effectiveAt, let asOf = source.asOf,
           let effective = parseInstant(effectiveAt), let asOfDate = parseInstant(asOf), effective > asOfDate {
            errors.append("Today action inbox source effectiveAt is after asOf")
        }
        if let asOf = source.asOf, let asOfDate = parseInstant(asOf), let fetchedAt = parseInstant(source.fetchedAt), asOfDate > fetchedAt {
            errors.append("Today action inbox source asOf is after fetchedAt")
        }
        if let validUntil = source.validUntil, let effectiveAt = source.effectiveAt,
           let validDate = parseInstant(validUntil), let effectiveDate = parseInstant(effectiveAt), validDate <= effectiveDate {
            errors.append("Today action inbox source validUntil is invalid")
        }
        if let fingerprint = source.sourceFingerprint, fingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("Today action inbox source fingerprint is invalid")
        }
        switch kind {
        case .research:
            guard let target = researchTarget, reviewEvent == nil, source.lane == "research" else {
                errors.append("research item navigation shape is invalid")
                return
            }
            if !["evidence", "portfolio"].contains(target.preferredLayer) || target.itemId.isEmpty || source.id != target.itemId || id != "inbox:event:research:\(membership.id):\(target.itemId)" {
                errors.append("research target identity is invalid")
            }
            if let report = target.report,
               report.id.isEmpty || report.evidencePackId.isEmpty || report.version < 1 {
                errors.append("research target report binding is invalid")
            }
            if let task = target.task {
                let readyTaskShape = task.completedAt != nil && state == .new && priority == "action" && source.freshness == "fresh"
                let activeTaskShape = task.completedAt == nil && priority == "high" && (state == .later && source.freshness == "fresh" || state == .new && source.freshness == "stale")
                if target.report != nil || (!readyTaskShape && !activeTaskShape) || source.sourceType != "deep_research_tasks" || source.sourceFingerprint != task.requestFingerprint {
                    errors.append("ready research task shape is invalid")
                }
                task.validate(report: nil, now: now, errors: &errors)
            }
        case .researchCompleted:
            guard let target = researchTarget, let report = target.report, reviewEvent == nil, source.lane == "research", [.new, .later, .resolved].contains(state), source.sourceType == "deep_research_reports",
                  source.id == report.id, source.version == report.version else {
                errors.append("completed research item shape is invalid")
                return
            }
            target.task?.validate(report: report, now: now, errors: &errors)
            if [.new, .later].contains(state) && target.task == nil {
                errors.append("actionable completed research item must bind its task")
            }
            if [.new, .later].contains(state) && target.task?.completedAt == nil {
                errors.append("actionable completed research item must bind a completed task")
            }
            let expectedId = target.task.map {
                "inbox:event:research_completed:\(membership.id):task:\($0.id)"
            } ?? "inbox:event:research_completed:\(membership.id):\(target.itemId)"
            if id != expectedId {
                errors.append("completed research identity is invalid")
            }
        case .materialChange:
            guard let target = researchTarget, reviewEvent == nil, source.lane == "research_material", [.new, .later, .resolved, .expired].contains(state),
                  source.sourceFingerprint != nil, ["fresh", "stale"].contains(source.freshness) else {
                errors.append("material change item shape is invalid")
                return
            }
            let sourceExpired = source.validUntil.flatMap(parseInstant).map { $0 <= now } == true
            if state == .expired && (!sourceExpired || source.freshness != "stale") {
                errors.append("expired material change must bind a stale expired source")
            }
            if [.new, .later].contains(state) && sourceExpired {
                errors.append("actionable material change cannot bind an expired source")
            }
            if id != "inbox:event:material_change:\(membership.id):\(source.id):v\(source.version.map(String.init) ?? "unknown")" {
                errors.append("material change identity is invalid")
            }
            if target.itemId.isEmpty { errors.append("material change target is invalid") }
        case .marketAnomaly:
            if researchTarget != nil || reviewEvent != nil || state != .new || source.lane != "market_quote"
                || source.sourceType != "personal_market_anomaly" || source.id != id
                || source.version != membership.version || source.sourceFingerprint == nil
                || !["fresh", "stale"].contains(source.freshness)
                || !id.hasPrefix("inbox:event:market_anomaly:\(membership.id):") {
                errors.append("market anomaly shape is invalid")
            }
        case .candidateFound:
            if researchTarget != nil || reviewEvent != nil || source.lane != "candidate_membership" || source.sourceType != "candidate_memberships" || ![.new, .later].contains(state)
                || source.id != membership.id || source.version != membership.version
                || source.effectiveAt == nil || source.asOf == nil || source.freshness != "fresh" || source.sourceFingerprint == nil
                || id != "inbox:event:candidate_found:\(membership.id):v\(membership.version)" {
                errors.append("candidate found item shape is invalid")
            }
        case .researchProfileReviewDue:
            if researchTarget != nil || reviewEvent != nil || source.lane != "candidate_membership" || source.sourceType != "research_profiles" || ![.new, .later].contains(state)
                || source.id != membership.id || source.version != membership.version || source.effectiveAt == nil || source.asOf == nil
                || source.freshness != "fresh" || source.sourceFingerprint == nil
                || id != "inbox:event:research_profile_review_due:\(membership.id):v\(membership.version):\(source.effectiveAt!.prefix(10))" {
                errors.append("research profile review item shape is invalid")
            }
        case .sourceFailure:
            let baseID = "inbox:failure:\(source.lane):\(membership.id)"
            let scopedIDs = source.lane == "market_quote" ? ["quote_validation", "benchmark"]
                : source.lane == "research" ? ["operating", "formal_review"] : []
            let validID = id == baseID || scopedIDs.contains { id == "\(baseID):\($0)" }
            if researchTarget != nil || reviewEvent != nil || state != .blocked
                || !id.hasPrefix("inbox:failure:")
                || !validID
                || source.status == "available"
                || (source.lane == "market_quote" && (source.sourceType != "persisted_market_quotes" || source.status != "unavailable" || source.freshness != "unavailable")) {
                errors.append("source failure shape is invalid")
            }
        case .formalDecisionDue, .reviewDue, .dailyTracking:
            guard let event = reviewEvent, researchTarget == nil, source.lane == "review_due" else {
                errors.append("review item navigation shape is invalid")
                return
            }
            let expectedType = kind == .formalDecisionDue ? "FORMAL_DECISION_DUE" : kind == .dailyTracking ? "DAILY_TRACKING" : "REVIEW_DUE"
            if !id.hasPrefix("inbox:event:") || id != "inbox:event:review_due:\(membership.id):\(event.id)"
                || source.id != event.id || source.version != Int(event.sourceEventId) || event.type != expectedType {
                errors.append("review item event identity is invalid")
            }
            do {
                let eventEnvelope = TodayReviewDueEnvelope(
                    schemaVersion: "2026-07-30.s1i-adopted-report-daily-tracking.v1",
                    status: .available,
                    requestedSymbol: symbol,
                    metadata: FactMetadata(
                        source: "today_action:confirmed_reports_decision_checks_reviews_audit_events",
                        asOf: event.stateChangedAt,
                        fetchedAt: event.stateChangedAt,
                        freshness: "fresh",
                        provenance: "real",
                        authority: event.type == "FORMAL_DECISION_DUE" ? "research_evidence" : "decision_context",
                        stale: false,
                        missing: false,
                        conflict: false,
                        fixture: false,
                        correctionOf: nil,
                        replaces: nil,
                        message: "Bound Today review event."
                    ),
                    event: event,
                    advisoryOnly: true,
                    safety: .noSideEffects,
                    message: "Bound Today review event."
                )
                try eventEnvelope.validateForDisplay(expectedSymbol: symbol)
            } catch {
                errors.append("review item event contract is invalid")
            }
        }
    }
}

public enum TodayActionInboxValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct TodayNavigationMembershipIdentity: Equatable, Sendable {
    public let id: String
    public let version: Int
    public let symbol: String
    public let actorId: String
    public let state: CandidateMembershipState

    public init(id: String, version: Int, symbol: String, actorId: String, state: CandidateMembershipState) {
        self.id = id
        self.version = version
        self.symbol = symbol
        self.actorId = actorId
        self.state = state
    }

    public init(_ member: CandidateMembershipData) {
        self.init(id: member.id, version: member.version, symbol: member.symbol,
                  actorId: member.actorId, state: member.state)
    }
}

/// Only an unchanged, freshly read item in the same actor's tracked membership
/// may leave Today. Target pages then validate the report/task/source themselves.
public func currentTodayNavigationItem(
    expected: TodayActionInboxItem,
    inbox: TodayActionInboxEnvelope,
    membership: TodayNavigationMembershipIdentity?
) -> TodayActionInboxItem? {
    guard inbox.status == .available,
          let item = inbox.items.first(where: { $0.id == expected.id }),
          item.id == expected.id,
          item.kind == expected.kind,
          item.state == expected.state,
          (item.state == .new || item.state == .later),
          item.symbol == expected.symbol,
          item.membership == expected.membership,
          item.researchTarget == expected.researchTarget,
          item.reviewEvent == expected.reviewEvent,
          item.source.lane == expected.source.lane,
          item.source.id == expected.source.id,
          item.source.version == expected.source.version,
          item.source.sourceType == expected.source.sourceType,
          item.source.sourceFingerprint == expected.source.sourceFingerprint,
          item.source.status == expected.source.status,
          item.source.freshness == expected.source.freshness,
          item.source.effectiveAt == expected.source.effectiveAt,
          item.source.asOf == expected.source.asOf,
          item.source.validUntil == expected.source.validUntil,
          let membership, membership.state == .tracked,
          membership.id == item.membership.id,
          membership.version == item.membership.version,
          membership.symbol == item.symbol,
          membership.actorId == inbox.requestedActorId else { return nil }
    return item
}

/// Formal Thesis review uses its trigger fingerprint, not a Today research-item id.
/// Ordinary decision reviews keep their separate reviewEvent navigation target.
public func todayFormalReviewTriggerFingerprint(_ item: TodayActionInboxItem) -> String? {
    guard item.kind == .research,
          item.source.lane == "research",
          item.source.sourceType == "research_review_v1",
          item.source.status == "available",
          item.source.freshness == "fresh",
          item.source.version == item.membership.version,
          let fingerprint = item.source.sourceFingerprint,
          fingerprint == item.source.id,
          item.researchTarget?.itemId == fingerprint,
          item.researchTarget?.report == nil,
          item.researchTarget?.task == nil,
          item.reviewEvent == nil else { return nil }
    return fingerprint
}

func parseInstant(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: value) { return parsed }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}
