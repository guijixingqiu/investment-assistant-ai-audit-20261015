import Foundation

public extension ResearchClient {
    func fetchAnnualDecisionBrief(membershipId: String) async -> AnnualDecisionBriefEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "decision-brief")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if isFailure(response: response),
               let failClosed = try? decodeAnnualDecisionBrief(data),
               failClosed.status != .available {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 503
                return failClosed.withClientFailureState(researchHTTPFailureState(statusCode))
            }
            try validate(response: response)
            return try decodeAnnualDecisionBrief(data)
        } catch ResearchClientError.httpStatus(let statusCode) {
            return .unavailable(
                "每日决策简报 HTTP 请求失败，已清除旧简报事实。",
                membershipId: membershipId,
                clientFailureState: researchHTTPFailureState(statusCode)
            )
        } catch is DecodingError {
            return .unavailable("每日决策简报响应格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch AnnualDecisionBriefValidationError.invalid {
            return .unavailable("每日决策简报响应语义无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch is URLError {
            return .unavailable("每日决策简报离线，已清除旧简报事实。", membershipId: membershipId, clientFailureState: "offline")
        } catch {
            return .unavailable("每日决策简报不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "unavailable")
        }
    }

    private func decodeAnnualDecisionBrief(_ data: Data) throws -> AnnualDecisionBriefEnvelope {
        try validateAnnualDecisionBriefRawContract(data)
        let envelope = try JSONDecoder().decode(AnnualDecisionBriefEnvelope.self, from: data)
        try envelope.validateForDisplay()
        return envelope
    }
}

public enum AnnualDecisionBriefStatus: String, Codable, Equatable, Sendable {
    case available
    case notFound = "not_found"
    case unavailable
}

public enum AnnualDecisionBriefReadinessState: String, Codable, Equatable, Sendable {
    case readyForThreeMinuteReview = "ready_for_three_minute_review"
    case researchRequired = "research_required"
    case blocked
}

public enum AnnualDecisionBriefValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct AnnualDecisionBriefEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-17.ios-annual-rings-decision-brief.v1"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: AnnualDecisionBriefStatus
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let metadata: FactMetadata
    public let data: AnnualDecisionBriefData?
    public let safety: AnnualDecisionBriefSafety
    public let message: String
    public let clientFailureState: String?

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case generatedAt
        case status
        case membershipId
        case requestedActorId
        case requestedSymbol
        case metadata
        case data
        case safety
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
        status = try container.decode(AnnualDecisionBriefStatus.self, forKey: .status)
        membershipId = try container.decode(String.self, forKey: .membershipId)
        requestedActorId = try container.decode(String.self, forKey: .requestedActorId)
        requestedSymbol = try container.decodeRequiredNullable(String.self, forKey: .requestedSymbol)
        metadata = try container.decode(FactMetadata.self, forKey: .metadata)
        data = try container.decodeRequiredNullable(AnnualDecisionBriefData.self, forKey: .data)
        safety = try container.decode(AnnualDecisionBriefSafety.self, forKey: .safety)
        message = try container.decode(String.self, forKey: .message)
        clientFailureState = nil
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(generatedAt, forKey: .generatedAt)
        try container.encode(status, forKey: .status)
        try container.encode(membershipId, forKey: .membershipId)
        try container.encode(requestedActorId, forKey: .requestedActorId)
        try container.encode(requestedSymbol, forKey: .requestedSymbol)
        try container.encode(metadata, forKey: .metadata)
        try container.encode(data, forKey: .data)
        try container.encode(safety, forKey: .safety)
        try container.encode(message, forKey: .message)
    }

    public static func unavailable(
        _ message: String,
        membershipId: String,
        clientFailureState: String = "unavailable"
    ) -> AnnualDecisionBriefEnvelope {
        let generatedAt = ISO8601DateFormatter().string(from: Date())
        return AnnualDecisionBriefEnvelope(
            schemaVersion: schemaVersionV1,
            generatedAt: generatedAt,
            status: .unavailable,
            membershipId: membershipId,
            requestedActorId: "unavailable",
            requestedSymbol: nil,
            metadata: FactMetadata(
                source: "annual_decision_brief",
                asOf: generatedAt,
                fetchedAt: generatedAt,
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
            data: nil,
            safety: .advisoryOnly,
            message: message,
            clientFailureState: clientFailureState
        )
    }

    fileprivate func withClientFailureState(_ state: String) -> AnnualDecisionBriefEnvelope {
        AnnualDecisionBriefEnvelope(
            schemaVersion: schemaVersion,
            generatedAt: generatedAt,
            status: status,
            membershipId: membershipId,
            requestedActorId: requestedActorId,
            requestedSymbol: requestedSymbol,
            metadata: metadata,
            data: data,
            safety: safety,
            message: message,
            clientFailureState: state
        )
    }

    public func validateForDisplay() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("annual decision brief schemaVersion is invalid")
        }
        if !isParseableDateTime(generatedAt) {
            errors.append("annual decision brief generatedAt must be a valid date-time")
        }
        if membershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("annual decision brief membershipId is required")
        }
        if requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("annual decision brief requestedActorId is required")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("annual decision brief message is required")
        }
        metadata.validateForDisplay(label: "annual decision brief", errors: &errors)
        safety.validate(errors: &errors)

        switch status {
        case .available:
            guard let data, let requestedSymbol else {
                errors.append("available annual decision brief requires data and requestedSymbol")
                break
            }
            if !["fresh", "historical", "stale", "missing", "unavailable", "conflict"].contains(metadata.freshness) {
                errors.append("available annual decision brief freshness is invalid")
            }
            if metadata.source != "annual_decision_brief:candidate_intake_research_quant" || metadata.authority != "research_evidence" {
                errors.append("available annual decision brief source authority is invalid")
            }
            data.validate(
                envelopeGeneratedAt: generatedAt,
                membershipId: membershipId,
                requestedSymbol: requestedSymbol,
                aggregateFreshness: metadata.freshness,
                aggregateFixture: metadata.fixture,
                aggregateProvenance: metadata.provenance,
                aggregateStale: metadata.stale,
                aggregateMissing: metadata.missing,
                aggregateConflict: metadata.conflict,
                errors: &errors
            )
        case .notFound, .unavailable:
            if data != nil || requestedSymbol != nil {
                errors.append("non-available annual decision brief must not expose facts")
            }
            if metadata.freshness == "fresh" {
                errors.append("non-available annual decision brief must not be fresh")
            }
        }

        if !errors.isEmpty {
            throw AnnualDecisionBriefValidationError.invalid(errors)
        }
    }

    private init(
        schemaVersion: String,
        generatedAt: String,
        status: AnnualDecisionBriefStatus,
        membershipId: String,
        requestedActorId: String,
        requestedSymbol: String?,
        metadata: FactMetadata,
        data: AnnualDecisionBriefData?,
        safety: AnnualDecisionBriefSafety,
        message: String,
        clientFailureState: String?
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.status = status
        self.membershipId = membershipId
        self.requestedActorId = requestedActorId
        self.requestedSymbol = requestedSymbol
        self.metadata = metadata
        self.data = data
        self.safety = safety
        self.message = message
        self.clientFailureState = clientFailureState
    }
}

public struct AnnualDecisionBriefData: Codable, Equatable, Sendable {
    public let target: AnnualDecisionBriefTarget
    public let sourceIdentity: AnnualDecisionBriefSourceIdentity
    public let whyNow: String?
    public let thesis: String?
    public let marketDisagreement: String?
    public let invalidationCondition: String?
    public let nextReviewOn: String?
    public let keyVariables: [AnnualDecisionBriefVariable]
    public let catalysts: [String]
    public let evidence: AnnualDecisionBriefEvidence
    public let quantEvidence: DecisionQuantEvidence
    public let readiness: AnnualDecisionBriefReadiness

    fileprivate func validate(
        envelopeGeneratedAt: String,
        membershipId: String,
        requestedSymbol: String,
        aggregateFreshness: String,
        aggregateFixture: Bool,
        aggregateProvenance: String,
        aggregateStale: Bool,
        aggregateMissing: Bool,
        aggregateConflict: Bool,
        errors: inout [String]
    ) {
        target.validate(membershipId: membershipId, requestedSymbol: requestedSymbol, errors: &errors)
        sourceIdentity.validate(
            envelopeGeneratedAt: envelopeGeneratedAt,
            expectedSymbol: requestedSymbol,
            errors: &errors
        )
        for (label, value) in [
            ("whyNow", whyNow),
            ("thesis", thesis),
            ("marketDisagreement", marketDisagreement),
            ("invalidationCondition", invalidationCondition),
            ("nextReviewOn", nextReviewOn)
        ] where value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("annual decision brief \(label) must be non-empty when present")
        }
        validateBoundedUniqueStrings(catalysts, field: "annual decision brief catalysts", errors: &errors)
        evidence.validate(errors: &errors)
        validateVariables(errors: &errors)
        quantEvidence.validateForDisplay(expectedSymbol: requestedSymbol, availableBy: envelopeGeneratedAt, errors: &errors)
        if let aggregateRank = annualDecisionBriefFreshnessRank(aggregateFreshness),
           let quantRank = annualDecisionBriefFreshnessRank(quantEvidence.metadata.freshness),
           aggregateRank < quantRank {
            errors.append("annual decision brief aggregate freshness must not be fresher than quant evidence")
        }
        if quantEvidence.metadata.fixture && (!aggregateFixture || aggregateProvenance != "fixture") {
            errors.append("annual decision brief aggregate metadata must preserve quant fixture provenance")
        }
        readiness.validate(
            evidence: evidence,
            errors: &errors
        )
        let quoteSnapshotMissing = sourceIdentity.quoteSnapshotId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        let sourceTimesMissing = sourceIdentity.researchAsOf == nil || sourceIdentity.evidenceAsOf == nil
        let quantTimesMissing = quantEvidence.metadata.asOf == nil || quantEvidence.metadata.fetchedAt == nil
        let factsRequireBlockedReadiness = target.membershipState == .archived
            || sourceTimesMissing
            || quoteSnapshotMissing
            || aggregateStale || aggregateMissing || aggregateConflict
            || !["fresh", "historical"].contains(aggregateFreshness)
            || quantEvidence.status != "available"
            || quantTimesMissing
            || !["fresh", "historical"].contains(quantEvidence.metadata.freshness)
        if factsRequireBlockedReadiness && readiness.state != .blocked {
            errors.append("annual decision brief fail-closed facts require blocked readiness")
        }
        if readiness.state == .readyForThreeMinuteReview {
            let requiredText = [whyNow, thesis, marketDisagreement, invalidationCondition]
            if target.membershipState != .tracked
                || sourceTimesMissing
                || requiredText.contains(where: { $0?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false })
                || keyVariables.isEmpty
                || catalysts.isEmpty
                || evidence.support.isEmpty
                || quantEvidence.status != "available"
                || quantTimesMissing
                || aggregateStale || aggregateMissing || aggregateConflict
                || !["fresh", "historical"].contains(quantEvidence.metadata.freshness)
                || !["fresh", "historical"].contains(aggregateFreshness) {
                errors.append("annual decision brief ready state requires current tracked research and bounded quant evidence")
            }
        }
    }

    private func validateVariables(errors: inout [String]) {
        if keyVariables.count > 20 {
            errors.append("annual decision brief keyVariables exceeds 20")
        }
        let names = keyVariables.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }
        if zip(keyVariables.map(\.name), names).contains(where: { $0 != $1 })
            || names.contains(where: { $0.isEmpty })
            || Set(names).count != names.count {
            errors.append("annual decision brief keyVariables must be unique and non-empty")
        }
        let evidenceItems = evidence.support + evidence.counter + evidence.neutral
        for variable in keyVariables {
            variable.validate(linkedEvidence: evidenceItems.filter { $0.variableName == variable.name }, errors: &errors)
        }
    }
}

private func annualDecisionBriefFreshnessRank(_ value: String) -> Int? {
    switch value {
    case "fresh": 0
    case "historical": 1
    case "stale": 2
    case "missing": 3
    case "unavailable", "unknown": 4
    case "conflict": 5
    default: nil
    }
}

public struct AnnualDecisionBriefTarget: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: CandidateMembershipState
    public let market: String
    public let code: String
    public let symbol: String

    fileprivate func validate(membershipId expectedMembershipId: String, requestedSymbol: String, errors: inout [String]) {
        if membershipId != expectedMembershipId || membershipVersion < 1 {
            errors.append("annual decision brief membership identity is invalid")
        }
        if market != "HK" || code.range(of: #"^\d{5}$"#, options: .regularExpression) == nil || symbol != "HK.\(code)" || symbol != requestedSymbol {
            errors.append("annual decision brief target must use one canonical Hong Kong identity")
        }
    }
}

public struct AnnualDecisionBriefSourceIdentity: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let researchAsOf: String?
    public let evidenceAsOf: String?
    public let quoteSnapshotId: String?
    public let decisionContextId: String
    public let decisionContextHash: String

    fileprivate func validate(
        envelopeGeneratedAt: String,
        expectedSymbol: String,
        errors: inout [String]
    ) {
        if generatedAt != envelopeGeneratedAt || !isParseableDateTime(generatedAt) {
            errors.append("annual decision brief source generatedAt must match envelope")
        }
        for (label, value) in [("researchAsOf", researchAsOf), ("evidenceAsOf", evidenceAsOf)] {
            if let value, !isParseableDateTime(value) {
                errors.append("annual decision brief source \(label) is invalid")
            }
        }
        if quoteSnapshotId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true || decisionContextId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("annual decision brief source identity is incomplete")
        }
        if let quoteSnapshotId, !quoteSnapshotId.hasPrefix("\(expectedSymbol):") {
            errors.append("annual decision brief quoteSnapshotId must bind the target symbol")
        }
        if decisionContextHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("annual decision brief decisionContextHash must be SHA-256")
        } else if decisionContextId != "decision-context:\(expectedSymbol):\(decisionContextHash.prefix(16))" {
            errors.append("annual decision brief decisionContextId must bind the target symbol and hash")
        }
    }
}

public struct AnnualDecisionBriefVariable: Codable, Equatable, Identifiable, Sendable {
    public var id: String { name }
    public let name: String
    public let evidenceIds: [String]
    public let supportCount: Int
    public let counterCount: Int
    public let neutralCount: Int
    public let highestReliability: Int?
    public let highestMateriality: Int?

    fileprivate func validate(linkedEvidence: [EvidenceItemData], errors: inout [String]) {
        if evidenceIds != linkedEvidence.map(\.id) || supportCount != linkedEvidence.filter({ $0.stance == .support }).count || counterCount != linkedEvidence.filter({ $0.stance == .refute }).count || neutralCount != linkedEvidence.filter({ $0.stance == .neutral }).count {
            errors.append("annual decision brief variable \(name) counts must match displayed evidence")
        }
        if highestReliability != linkedEvidence.compactMap(\.reliability).max() || highestMateriality != linkedEvidence.compactMap(\.materiality).max() {
            errors.append("annual decision brief variable \(name) quality must match displayed evidence")
        }
    }
}

public struct AnnualDecisionBriefConflict: Codable, Equatable, Identifiable, Sendable {
    public var id: String { variableName }
    public let variableName: String
    public let supportingEvidenceIds: [String]
    public let counterEvidenceIds: [String]
}

public struct AnnualDecisionBriefEvidence: Codable, Equatable, Sendable {
    public let support: [EvidenceItemData]
    public let counter: [EvidenceItemData]
    public let neutral: [EvidenceItemData]
    public let conflicts: [AnnualDecisionBriefConflict]
    public let gaps: [String]

    fileprivate func validate(errors: inout [String]) {
        let grouped = [(support, EvidenceStance.support), (counter, .refute), (neutral, .neutral)]
        let all = support + counter + neutral
        if grouped.contains(where: { $0.0.count > 100 }) || Set(all.map(\.id)).count != all.count {
            errors.append("annual decision brief evidence must be bounded with unique ids")
        }
        for (items, expectedStance) in grouped {
            for item in items {
                item.validateForDisplay(errors: &errors)
                if item.stance != expectedStance {
                    errors.append("annual decision brief evidence stance group is invalid")
                }
            }
        }
        validateBoundedUniqueStrings(gaps, field: "annual decision brief gaps", errors: &errors)
        let conflictNames = conflicts.map(\.variableName)
        let expectedConflictNames = Set(all.compactMap(\.variableName).filter { variableName in
            support.contains(where: { $0.variableName == variableName })
                && counter.contains(where: { $0.variableName == variableName })
        })
        if Set(conflictNames) != expectedConflictNames || Set(conflictNames).count != conflictNames.count {
            errors.append("annual decision brief conflicts must cover each displayed support/counter variable exactly once")
        }
        for conflict in conflicts {
            let expectedSupport = support.filter { $0.variableName == conflict.variableName }.map(\.id)
            let expectedCounter = counter.filter { $0.variableName == conflict.variableName }.map(\.id)
            if conflict.variableName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || conflict.supportingEvidenceIds != expectedSupport
                || conflict.counterEvidenceIds != expectedCounter {
                errors.append("annual decision brief conflict must match displayed support and counter evidence for its variable")
            }
        }
    }
}

public struct AnnualDecisionBriefReadiness: Codable, Equatable, Sendable {
    public let state: AnnualDecisionBriefReadinessState
    public let reasons: [String]
    public let hasCounterOrGap: Bool
    public let threeMinuteReviewReady: Bool

    fileprivate func validate(
        evidence: AnnualDecisionBriefEvidence,
        errors: inout [String]
    ) {
        validateBoundedUniqueStrings(reasons, field: "annual decision brief readiness reasons", errors: &errors)
        let contractHasCounterOrGap = !evidence.counter.isEmpty || !evidence.gaps.isEmpty
        if hasCounterOrGap != contractHasCounterOrGap {
            errors.append("annual decision brief readiness counter-or-gap state is inconsistent")
        }
        if state == .readyForThreeMinuteReview {
            if !threeMinuteReviewReady || !reasons.isEmpty || !contractHasCounterOrGap {
                errors.append("annual decision brief ready state is internally inconsistent")
            }
        } else if threeMinuteReviewReady || reasons.isEmpty {
            errors.append("annual decision brief non-ready state requires server reasons and cannot be ready")
        }
    }
}

public struct AnnualDecisionBriefSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let changesCandidateOrdering: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let targetPrice: Bool
    public let targetPosition: Bool
    public let tradeDirection: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool

    public static let advisoryOnly = AnnualDecisionBriefSafety(
        advisoryOnly: true,
        changesCandidateOrdering: false,
        recommendation: false,
        ranking: false,
        targetPrice: false,
        targetPosition: false,
        tradeDirection: false,
        createsOrder: false,
        createsTrade: false,
        callsBroker: false,
        mutatesOfficialPortfolio: false
    )

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || changesCandidateOrdering || recommendation || ranking || targetPrice || targetPosition || tradeDirection || createsOrder || createsTrade || callsBroker || mutatesOfficialPortfolio {
            errors.append("annual decision brief safety must remain advisory-only without recommendation or trading authority")
        }
    }
}

public struct AnnualDecisionBriefRenderModel: Equatable, Sendable {
    public let state: String
    public let membershipId: String?
    public let symbol: String?
    public let title: String
    public let message: String
    public let metadata: FactMetadata?
    public let data: AnnualDecisionBriefData?
}

public func annualDecisionBriefRenderModel(from envelope: AnnualDecisionBriefEnvelope) -> AnnualDecisionBriefRenderModel {
    let state: String
    if envelope.status == .available {
        state = envelope.data?.readiness.state.rawValue ?? "malformed"
    } else if envelope.status == .notFound {
        state = "not_found"
    } else {
        state = annualDecisionBriefClientFailureState(envelope.clientFailureState)
    }
    return AnnualDecisionBriefRenderModel(
        state: state,
        membershipId: envelope.membershipId,
        symbol: envelope.requestedSymbol,
        title: annualDecisionBriefTitle(state),
        message: envelope.message,
        metadata: envelope.metadata,
        data: envelope.status == .available ? envelope.data : nil
    )
}

public func annualDecisionBriefFailClosedModel(
    state: String,
    message: String,
    membershipId: String? = nil
) -> AnnualDecisionBriefRenderModel {
    AnnualDecisionBriefRenderModel(
        state: state,
        membershipId: membershipId,
        symbol: nil,
        title: annualDecisionBriefTitle(state),
        message: message,
        metadata: nil,
        data: nil
    )
}

public func annualDecisionBriefStateLabel(_ state: String) -> String {
    switch state {
    case AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue: "三分钟复核就绪"
    case AnnualDecisionBriefReadinessState.researchRequired.rawValue: "待补研究"
    case AnnualDecisionBriefReadinessState.blocked.rawValue: "事实阻止"
    case "loading": "读取中"
    case "unauthorized": "未授权"
    case "not_found": "候选不存在"
    case "malformed": "响应无效"
    case "offline": "离线"
    case "stale": "事实陈旧"
    case "superseded": "已切换候选"
    default: "不可用"
    }
}

func validateAnnualDecisionBriefRawContract(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw AnnualDecisionBriefValidationError.invalid(["annual decision brief response must be an object"])
    }
    try validateAnnualDecisionBriefRawObject(root)
}

func validateAnnualDecisionBriefRawObject(_ root: [String: Any]) throws {
    let required = Set(["schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId", "requestedSymbol", "metadata", "data", "safety", "message"])
    if Set(root.keys) != required {
        throw AnnualDecisionBriefValidationError.invalid(["annual decision brief envelope keys are invalid"])
    }
    let forbidden = Set(["recommendedAction", "rankingScore", "suggestedPosition", "orderRequest", "brokerAccount", "tradeSignal"])
    var found: [String] = []
    scanAnnualDecisionBriefKeys(root, forbidden: forbidden, found: &found)
    if !found.isEmpty {
        throw AnnualDecisionBriefValidationError.invalid(found.map { "annual decision brief contains forbidden field \($0)" })
    }
}

private func scanAnnualDecisionBriefKeys(_ value: Any, forbidden: Set<String>, found: inout [String]) {
    if let object = value as? [String: Any] {
        for (key, child) in object {
            if forbidden.contains(key) { found.append(key) }
            scanAnnualDecisionBriefKeys(child, forbidden: forbidden, found: &found)
        }
    } else if let array = value as? [Any] {
        array.forEach { scanAnnualDecisionBriefKeys($0, forbidden: forbidden, found: &found) }
    }
}

private func annualDecisionBriefClientFailureState(_ value: String?) -> String {
    switch value {
    case "unauthorized", "not_found", "conflict", "malformed", "offline", "stale", "superseded": value!
    default: "unavailable"
    }
}

private func annualDecisionBriefTitle(_ state: String) -> String {
    switch state {
    case AnnualDecisionBriefReadinessState.readyForThreeMinuteReview.rawValue: "可进行三分钟复核"
    case AnnualDecisionBriefReadinessState.researchRequired.rawValue: "需要补充研究"
    case AnnualDecisionBriefReadinessState.blocked.rawValue: "当前事实阻止复核"
    case "unauthorized": "简报读取未授权"
    case "not_found": "候选成员不存在"
    case "malformed": "简报响应无效"
    case "offline": "简报读取离线"
    case "loading": "正在读取每日简报"
    default: "每日简报不可用"
    }
}

private extension KeyedDecodingContainer {
    func decodeRequiredNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(codingPath: codingPath, debugDescription: "Required nullable key '\(key.stringValue)' is missing")
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}
