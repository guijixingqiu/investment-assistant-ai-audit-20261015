import Foundation

public enum AnnualDecisionBriefDraftError: Error, Equatable, Sendable {
    case invalid(String)
}

public enum AnnualDecisionBriefProfileDraftSourceState: String, Equatable, Sendable {
    case existing
    case missing
}

public struct AnnualDecisionBriefProfileDraftSource: Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let state: AnnualDecisionBriefProfileDraftSourceState

    public init?(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        envelope: ResearchProfileEnvelope
    ) {
        guard !membershipId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              membershipVersion > 0,
              envelope.requestedSymbol == symbol,
              let metadata = envelope.metadata,
              metadata.authority == "research_evidence",
              !metadata.stale,
              !metadata.conflict else {
            return nil
        }
        let state: AnnualDecisionBriefProfileDraftSourceState
        if let profile = envelope.data?.profile {
            guard profile.symbol == symbol,
                  metadata.freshness == "fresh",
                  !metadata.missing else {
                return nil
            }
            state = .existing
        } else {
            guard metadata.freshness == "missing",
                  metadata.missing else {
                return nil
            }
            state = .missing
        }
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.state = state
    }

    public func allowsProfileWrite(
        membershipId: String,
        membershipVersion: Int,
        symbol: String
    ) -> Bool {
        self.membershipId == membershipId
            && self.membershipVersion == membershipVersion
            && self.symbol == symbol
    }

    public func allowsEvidenceWrite(
        membershipId: String,
        membershipVersion: Int,
        symbol: String
    ) -> Bool {
        state == .existing
            && allowsProfileWrite(
                membershipId: membershipId,
                membershipVersion: membershipVersion,
                symbol: symbol
            )
    }
}

public struct AnnualDecisionBriefProfileSubmissionFingerprint: Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let request: UpdateResearchProfileRequest

    public init(membershipId: String, membershipVersion: Int, symbol: String, request: UpdateResearchProfileRequest) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.request = request
    }
}

public struct AnnualDecisionBriefEvidenceSubmissionFingerprint: Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let request: CreateEvidenceRequest

    public init(membershipId: String, membershipVersion: Int, symbol: String, request: CreateEvidenceRequest) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.request = request
    }
}

public struct PendingAnnualDecisionBriefSubmission<Fingerprint: Equatable & Sendable>: Equatable, Sendable {
    public let idempotencyKey: String
    public let fingerprint: Fingerprint
    public let reservationId: UUID
}

public struct AnnualDecisionBriefSubmissionState<Fingerprint: Equatable & Sendable> {
    private var pending: PendingAnnualDecisionBriefSubmission<Fingerprint>?
    private var active: PendingAnnualDecisionBriefSubmission<Fingerprint>?
    private let makeIdempotencyKey: () -> String
    private let makeReservationId: () -> UUID

    public init(
        makeIdempotencyKey: @escaping () -> String = { UUID().uuidString.lowercased() },
        makeReservationId: @escaping () -> UUID = { UUID() }
    ) {
        self.makeIdempotencyKey = makeIdempotencyKey
        self.makeReservationId = makeReservationId
    }

    public var isInFlight: Bool { active != nil }

    public func isCurrent(_ submission: PendingAnnualDecisionBriefSubmission<Fingerprint>) -> Bool {
        active == submission && pending == submission
    }

    public mutating func begin(fingerprint: Fingerprint) -> PendingAnnualDecisionBriefSubmission<Fingerprint>? {
        if active != nil { return nil }
        let idempotencyKey: String
        if let pending, pending.fingerprint == fingerprint {
            idempotencyKey = pending.idempotencyKey
        } else {
            idempotencyKey = makeIdempotencyKey()
        }
        let next = PendingAnnualDecisionBriefSubmission(
            idempotencyKey: idempotencyKey,
            fingerprint: fingerprint,
            reservationId: makeReservationId()
        )
        pending = next
        active = next
        return next
    }

    @discardableResult
    public mutating func finishSuccessOrReplay(
        for submission: PendingAnnualDecisionBriefSubmission<Fingerprint>
    ) -> Bool {
        guard isCurrent(submission) else { return false }
        active = nil
        pending = nil
        return true
    }

    @discardableResult
    public mutating func finishFailurePreservingRetry(
        for submission: PendingAnnualDecisionBriefSubmission<Fingerprint>
    ) -> Bool {
        guard isCurrent(submission) else { return false }
        active = nil
        return true
    }
}

public typealias AnnualDecisionBriefProfileSubmissionState = AnnualDecisionBriefSubmissionState<AnnualDecisionBriefProfileSubmissionFingerprint>
public typealias AnnualDecisionBriefEvidenceSubmissionState = AnnualDecisionBriefSubmissionState<AnnualDecisionBriefEvidenceSubmissionFingerprint>

public struct AnnualDecisionBriefProfileDraft: Equatable, Sendable {
    public var whyNow: String
    public var thesis: String
    public var marketDisagreement: String
    public var invalidationCondition: String
    public var nextReviewOn: String
    public var keyVariables: String { didSet { keyVariablesKnown = true } }
    public var catalysts: String { didSet { catalystsKnown = true } }
    public var evidenceGaps: [String] { didSet { evidenceGapsKnown = true } }
    public var monitorRules: [ResearchMonitorRuleDraft] { didSet { monitorRulesKnown = true } }
    public private(set) var keyVariablesKnown: Bool
    public private(set) var catalystsKnown: Bool
    public private(set) var evidenceGapsKnown: Bool
    public private(set) var monitorRulesKnown: Bool

    public static let empty = AnnualDecisionBriefProfileDraft(
        whyNow: "",
        thesis: "",
        marketDisagreement: "",
        invalidationCondition: "",
        nextReviewOn: "",
        keyVariables: "",
        catalysts: "",
        evidenceGaps: [],
        monitorRules: []
    )

    public init(profile: ResearchProfileData) {
        whyNow = profile.currentView
        thesis = profile.currentThesis
        marketDisagreement = profile.marketDisagreement ?? ""
        invalidationCondition = profile.invalidationCondition ?? ""
        nextReviewOn = profile.nextReviewOn ?? ""
        keyVariables = (profile.keyVariables ?? []).joined(separator: "\n")
        catalysts = (profile.catalysts ?? []).joined(separator: "\n")
        // One profile item may contain its own line breaks; keep the API array boundary.
        evidenceGaps = profile.evidenceGaps ?? []
        monitorRules = (profile.monitorRules ?? []).map(ResearchMonitorRuleDraft.init)
        keyVariablesKnown = profile.keyVariables != nil
        catalystsKnown = profile.catalysts != nil
        evidenceGapsKnown = profile.evidenceGaps != nil
        monitorRulesKnown = profile.monitorRules != nil
    }

    public init(
        whyNow: String,
        thesis: String,
        marketDisagreement: String,
        invalidationCondition: String,
        nextReviewOn: String,
        keyVariables: String,
        catalysts: String,
        evidenceGaps: [String],
        monitorRules: [ResearchMonitorRuleDraft] = []
    ) {
        self.whyNow = whyNow
        self.thesis = thesis
        self.marketDisagreement = marketDisagreement
        self.invalidationCondition = invalidationCondition
        self.nextReviewOn = nextReviewOn
        self.keyVariables = keyVariables
        self.catalysts = catalysts
        self.evidenceGaps = evidenceGaps
        self.monitorRules = monitorRules
        keyVariablesKnown = true
        catalystsKnown = true
        evidenceGapsKnown = true
        monitorRulesKnown = true
    }

    public func request(
        membershipId: String,
        membershipVersion: Int,
        idempotencyKey: String
    ) throws -> UpdateResearchProfileRequest {
        let whyNow = try required(self.whyNow, label: "为何现在值得研究")
        let thesis = try required(self.thesis, label: "投资论点")
        let nextReviewOn = optional(self.nextReviewOn)
        if let nextReviewOn, nextReviewOn.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) == nil {
            throw AnnualDecisionBriefDraftError.invalid("下次复核日期必须使用 YYYY-MM-DD。")
        }
        let variables = keyVariablesKnown ? try lines(keyVariables, label: "关键变量") : nil
        let rules = monitorRulesKnown ? try monitorRules.map { try $0.rule(keyVariables: variables ?? []) } : nil
        guard rules.map({ Set($0.map(\.variableName)).count == $0.count }) != false else {
            throw AnnualDecisionBriefDraftError.invalid("每个关键变量最多只能有一条正式监控规则。")
        }
        return UpdateResearchProfileRequest(
            membershipId: try required(membershipId, label: "候选身份"),
            membershipVersion: try positiveVersion(membershipVersion),
            currentView: whyNow,
            currentThesis: thesis,
            marketDisagreement: optional(marketDisagreement),
            invalidationCondition: optional(invalidationCondition),
            nextReviewOn: nextReviewOn,
            keyVariables: variables,
            catalysts: catalystsKnown ? try lines(catalysts, label: "催化剂") : nil,
            evidenceGaps: evidenceGapsKnown ? try validatedEvidenceGapItems(evidenceGaps) : nil,
            monitorRules: rules,
            idempotencyKey: try required(idempotencyKey, label: "幂等键")
        )
    }

    @discardableResult
    public mutating func appendEvidenceGap(_ value: String) throws -> Bool {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AnnualDecisionBriefDraftError.invalid("请先填写待核查问题。")
        }
        let existing = try validatedEvidenceGapItems(evidenceGaps)
        if existing.contains(value) { return false }
        _ = try validatedEvidenceGapItems(existing + [value])
        evidenceGaps.append(value)
        return true
    }
}

public struct AnnualDecisionBriefEvidenceDraft: Equatable, Sendable {
    public var sourceType: String
    public var sourceURL: String
    public var summary: String
    public var factKind: FactKind
    public var stance: EvidenceStance
    public var variableName: String
    public var reliability: Int
    public var materiality: Int
    public var isRead: Bool

    public static let empty = AnnualDecisionBriefEvidenceDraft(
        sourceType: "company_disclosure",
        sourceURL: "",
        summary: "",
        factKind: .fact,
        stance: .neutral,
        variableName: "",
        reliability: 3,
        materiality: 3,
        isRead: true
    )

    public func request(
        membershipId: String,
        membershipVersion: Int,
        idempotencyKey: String
    ) throws -> CreateEvidenceRequest {
        guard (1...5).contains(reliability), (1...5).contains(materiality) else {
            throw AnnualDecisionBriefDraftError.invalid("可靠性和重要性必须在 1 到 5 之间。")
        }
        return CreateEvidenceRequest(
            membershipId: try required(membershipId, label: "候选身份"),
            membershipVersion: try positiveVersion(membershipVersion),
            sourceType: try required(sourceType, label: "证据来源类型"),
            sourceUrl: optional(sourceURL),
            summary: try required(summary, label: "证据摘要"),
            factKind: factKind,
            stance: stance,
            variableName: optional(variableName),
            reliability: reliability,
            materiality: materiality,
            isRead: isRead,
            idempotencyKey: try required(idempotencyKey, label: "幂等键")
        )
    }
}

private func required(_ value: String, label: String) throws -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        throw AnnualDecisionBriefDraftError.invalid("\(label)不能为空。")
    }
    return trimmed
}

private func optional(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func positiveVersion(_ value: Int) throws -> Int {
    guard value > 0 else {
        throw AnnualDecisionBriefDraftError.invalid("候选版本必须为正整数。")
    }
    return value
}

private func lines(_ value: String, label: String) throws -> [String] {
    let values = value
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard values.count <= 20, Set(values).count == values.count, values.allSatisfy({ $0.count <= 500 }) else {
        throw AnnualDecisionBriefDraftError.invalid("\(label)最多 20 项，且必须去重并逐行填写。")
    }
    return values
}

private func validatedEvidenceGapItems(_ values: [String]) throws -> [String] {
    guard values.count <= 20, Set(values).count == values.count,
          values.allSatisfy({ !$0.isEmpty
              && $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines)
              && $0.utf16.count <= 500 }) else {
        throw AnnualDecisionBriefDraftError.invalid("证据缺口最多 20 项；每项须有内容、首尾不留空格、不重复且不超过 500 字。")
    }
    return values
}
