import Foundation

/// Optional reference to a current research change and an earlier saved
/// ordinary judgment. The Owner still writes a new editable judgment explicitly.
public struct OrdinaryResearchChangeBinding: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let changeId: String
    public let reasoningFingerprint: String
    public let selectedFactId: String
    public let sourceMaterialId: String
    public let sourceMaterialRevision: Int
    public let sourceContentFingerprint: String
    public let sourcePublishedAt: String
    public let factPeriodEnd: String
    public let previousDecisionCheckId: String
    public let nextQuestion: String

    public init(membershipId: String, membershipVersion: Int, symbol: String,
                changeId: String, reasoningFingerprint: String, selectedFactId: String,
                sourceMaterialId: String, sourceMaterialRevision: Int,
                sourceContentFingerprint: String, sourcePublishedAt: String,
                factPeriodEnd: String, previousDecisionCheckId: String,
                nextQuestion: String) {
        self.membershipId = membershipId; self.membershipVersion = membershipVersion
        self.symbol = symbol; self.changeId = changeId
        self.reasoningFingerprint = reasoningFingerprint; self.selectedFactId = selectedFactId
        self.sourceMaterialId = sourceMaterialId; self.sourceMaterialRevision = sourceMaterialRevision
        self.sourceContentFingerprint = sourceContentFingerprint; self.sourcePublishedAt = sourcePublishedAt
        self.factPeriodEnd = factPeriodEnd; self.previousDecisionCheckId = previousDecisionCheckId
        self.nextQuestion = nextQuestion
    }
}

public struct DecisionCheckSubmissionFingerprint: Equatable, Sendable {
    public let contextId: String
    public let contextHash: String
    public let decisionSnapshotBinding: DecisionSnapshotBinding?
    public let conditionalDecision: AnnualConditionalDecisionSubmission?
    public let sessionDraftBinding: SessionDraftFormalDecisionBinding?
    public let researchReportBinding: ResearchReportDecisionBinding?
    public let formalDecision: FormalOwnerDecisionInput?
    public let actionIntent: String
    public let humanCheckResult: String
    public let userFinalDecision: String?
    public let reviewDueOn: String?
    public let manualSourceBindings: [ManualDecisionSourceBinding]?
    public let researchChangeBinding: OrdinaryResearchChangeBinding?

    public init(
        contextId: String,
        contextHash: String,
        decisionSnapshotBinding: DecisionSnapshotBinding? = nil,
        conditionalDecision: AnnualConditionalDecisionSubmission? = nil,
        sessionDraftBinding: SessionDraftFormalDecisionBinding? = nil,
        researchReportBinding: ResearchReportDecisionBinding? = nil,
        formalDecision: FormalOwnerDecisionInput? = nil,
        actionIntent: String,
        humanCheckResult: String,
        userFinalDecision: String?,
        reviewDueOn: String? = nil,
        manualSourceBindings: [ManualDecisionSourceBinding]? = nil,
        researchChangeBinding: OrdinaryResearchChangeBinding? = nil
    ) {
        self.contextId = contextId
        self.contextHash = contextHash
        self.decisionSnapshotBinding = decisionSnapshotBinding
        self.conditionalDecision = conditionalDecision
        self.sessionDraftBinding = sessionDraftBinding
        self.researchReportBinding = researchReportBinding
        self.formalDecision = formalDecision
        self.actionIntent = actionIntent
        self.humanCheckResult = humanCheckResult
        self.userFinalDecision = userFinalDecision
        self.reviewDueOn = reviewDueOn
        self.manualSourceBindings = manualSourceBindings
        self.researchChangeBinding = researchChangeBinding
    }

    public static func == (
        lhs: DecisionCheckSubmissionFingerprint,
        rhs: DecisionCheckSubmissionFingerprint
    ) -> Bool {
        lhs.contextId == rhs.contextId
            && lhs.contextHash == rhs.contextHash
            && lhs.decisionSnapshotBinding == rhs.decisionSnapshotBinding
            && sameConditionalDecision(lhs.conditionalDecision, rhs.conditionalDecision)
            && lhs.sessionDraftBinding == rhs.sessionDraftBinding
            && lhs.researchReportBinding == rhs.researchReportBinding
            && lhs.formalDecision == rhs.formalDecision
            && lhs.actionIntent == rhs.actionIntent
            && lhs.humanCheckResult == rhs.humanCheckResult
            && lhs.userFinalDecision == rhs.userFinalDecision
            && lhs.reviewDueOn == rhs.reviewDueOn
            && lhs.manualSourceBindings == rhs.manualSourceBindings
            && lhs.researchChangeBinding == rhs.researchChangeBinding
    }

    private static func sameConditionalDecision(
        _ lhs: AnnualConditionalDecisionSubmission?,
        _ rhs: AnnualConditionalDecisionSubmission?
    ) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil):
            true
        case let (lhs?, rhs?):
            if let lhsId = lhs.preview.previewId, let rhsId = rhs.preview.previewId {
                lhsId == rhsId && lhs.judgment == rhs.judgment
            } else {
                lhs == rhs
            }
        default:
            false
        }
    }
}

public struct PendingDecisionCheckSubmission: Equatable, Sendable {
    public let idempotencyKey: String
    public let fingerprint: DecisionCheckSubmissionFingerprint
    public let generation: UInt64
}

/// Retains the exact ordinary request after an uncertain write outcome.
/// A changed canonical context must never turn this reservation into a new key.
public struct ManualDecisionRequestReservation: Equatable, Sendable {
    public let symbol: String
    public let membershipId: String
    public let membershipVersion: Int
    public let connectionScope: String
    public let handoffId: UUID
    public let authorizationRevision: UUID
    public let request: CreateDecisionCheckRequest

    public init(symbol: String, membershipId: String, membershipVersion: Int,
                connectionScope: String, handoffId: UUID, authorizationRevision: UUID,
                request: CreateDecisionCheckRequest) {
        self.symbol = symbol
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.connectionScope = connectionScope
        self.handoffId = handoffId
        self.authorizationRevision = authorizationRevision
        self.request = request
    }

    public var fingerprint: DecisionCheckSubmissionFingerprint {
        DecisionCheckSubmissionFingerprint(
            contextId: request.contextId, contextHash: request.contextHash,
            actionIntent: request.actionIntent, humanCheckResult: request.humanCheckResult,
            userFinalDecision: request.userFinalDecision,
            reviewDueOn: request.reviewDueOn,
            manualSourceBindings: request.manualSourceBindings,
            researchChangeBinding: request.researchChangeBinding
        )
    }

    public func recoverableRequest(symbol: String, membershipId: String, membershipVersion: Int,
                                   connectionScope: String, handoffId: UUID,
                                   authorizationRevision: UUID) -> CreateDecisionCheckRequest? {
        guard self.symbol == symbol, self.membershipId == membershipId,
              self.membershipVersion == membershipVersion,
              self.connectionScope == connectionScope,
              self.handoffId == handoffId,
              self.authorizationRevision == authorizationRevision else { return nil }
        return request
    }
}

public struct DecisionCheckSubmissionState {
    private var pending: PendingDecisionCheckSubmission?
    private var active: PendingDecisionCheckSubmission?
    private var generation: UInt64 = 0
    private let makeIdempotencyKey: () -> String

    public init(makeIdempotencyKey: @escaping () -> String = { UUID().uuidString }) {
        self.makeIdempotencyKey = makeIdempotencyKey
    }

    public var isInFlight: Bool {
        active != nil
    }

    public var hasResearchReportSubmission: Bool {
        pending?.fingerprint.researchReportBinding != nil
            || active?.fingerprint.researchReportBinding != nil
    }

    public func isCurrent(_ submission: PendingDecisionCheckSubmission) -> Bool {
        active == submission && pending == submission && isLatest(submission)
    }

    public func isLatest(_ submission: PendingDecisionCheckSubmission) -> Bool {
        generation == submission.generation
    }

    public mutating func begin(fingerprint: DecisionCheckSubmissionFingerprint) -> PendingDecisionCheckSubmission? {
        if active != nil { return nil }
        if let pending, pending.fingerprint == fingerprint {
            if pending.generation == generation {
                active = pending
                return pending
            }
            generation &+= 1
            let rebound = PendingDecisionCheckSubmission(
                idempotencyKey: pending.idempotencyKey,
                fingerprint: pending.fingerprint,
                generation: generation
            )
            self.pending = rebound
            active = rebound
            return rebound
        }

        generation &+= 1
        let next = PendingDecisionCheckSubmission(
            idempotencyKey: makeIdempotencyKey(),
            fingerprint: fingerprint,
            generation: generation
        )
        pending = next
        active = next
        return next
    }

    public mutating func finishSuccessOrReplay() {
        active = nil
        pending = nil
    }

    @discardableResult
    public mutating func finishSuccessOrReplay(
        for submission: PendingDecisionCheckSubmission
    ) -> Bool {
        guard active == submission else { return false }
        let wasCurrent = pending == submission && isLatest(submission)
        active = nil
        if wasCurrent { pending = nil }
        return wasCurrent
    }

    public mutating func finishFailurePreservingRetry() {
        active = nil
    }

    @discardableResult
    public mutating func finishFailurePreservingRetry(
        for submission: PendingDecisionCheckSubmission
    ) -> Bool {
        guard active == submission else { return false }
        let wasCurrent = pending == submission && isLatest(submission)
        active = nil
        return wasCurrent
    }

    public mutating func resetForNewCheck() {
        generation &+= 1
    }

    public mutating func discardForSourceDrift() {
        generation &+= 1
        pending = nil
    }

    public mutating func prepareResearchReportAdoption(_ binding: ResearchReportDecisionBinding) {
        guard let pending else { return }
        if pending.fingerprint.researchReportBinding != binding { discardForSourceDrift() }
    }
}

public enum DecisionWriteOperation: Equatable, Sendable {
    case humanCheck
    case postDecisionReview
}

public enum DecisionWriteFailureState: String, Equatable, Sendable {
    case malformed
    case unauthorized
    case notFound = "not_found"
    case conflict
    case unavailable
    case semanticInvalid = "semantic-invalid"
    case decodingInvalid = "decoding-invalid"
    case offline
}

public struct DecisionWriteFailurePresentation: Equatable, Sendable {
    public let state: DecisionWriteFailureState
    public let message: String
}

public func decisionWriteFailurePresentation(
    for error: Error,
    operation: DecisionWriteOperation
) -> DecisionWriteFailurePresentation {
    let noun = operation == .humanCheck ? "人工检查" : "复盘"
    let retryBoundary = operation == .humanCheck ? "同一人工检查请求" : "同一复盘请求"

    if case ResearchClientError.httpStatus(let status) = error {
        switch status {
        case 400:
            return DecisionWriteFailurePresentation(
                state: .malformed,
                message: "\(noun)写入状态 malformed：请求无效，已清除旧\(noun)状态；不会显示旧成功。"
            )
        case 401:
            return DecisionWriteFailurePresentation(
                state: .unauthorized,
                message: "\(noun)写入状态 unauthorized：需要写入授权，已清除旧\(noun)状态；不会伪装成空成功。"
            )
        case 404:
            return DecisionWriteFailurePresentation(
                state: .notFound,
                message: "\(noun)写入状态 not_found：目标不存在或已变更，已清除旧\(noun)状态。"
            )
        case 409:
            return DecisionWriteFailurePresentation(
                state: .conflict,
                message: "\(noun)写入状态 conflict：上下文、归属或幂等键冲突；保留 idempotency key 以便\(retryBoundary)确认后重试。"
            )
        case 500...599:
            return DecisionWriteFailurePresentation(
                state: .unavailable,
                message: "\(noun)写入状态 unavailable：服务或仓库不可用，已清除旧\(noun)状态；保留 idempotency key 以便安全重试。"
            )
        default:
            return DecisionWriteFailurePresentation(
                state: .unavailable,
                message: "\(noun)写入状态 unavailable：HTTP \(status)，已清除旧\(noun)状态。"
            )
        }
    }

    if case DecisionWriteValidationError.invalid(_) = error {
        return DecisionWriteFailurePresentation(
            state: .semanticInvalid,
            message: "\(noun)写入状态 semantic-invalid：响应语义无效，已清除旧\(noun)状态；不会显示未验证成功。"
        )
    }

    if error is DecodingError {
        return DecisionWriteFailurePresentation(
            state: .decodingInvalid,
            message: "\(noun)写入状态 decoding-invalid：响应格式无效，已清除旧\(noun)状态；不会显示未验证成功。"
        )
    }

    if error is URLError {
        return DecisionWriteFailurePresentation(
            state: .offline,
            message: "\(noun)写入状态 offline：网络或本地请求失败，已清除旧\(noun)状态；只保留本机重试能力。"
        )
    }

    return DecisionWriteFailurePresentation(
        state: .unavailable,
        message: "\(noun)写入状态 unavailable：服务不可用，已清除旧\(noun)状态；\(error.localizedDescription)"
    )
}

public struct DecisionReviewSubmissionFingerprint: Equatable, Sendable {
    public let checkId: String
    public let outcome: DecisionReviewOutcome
    public let outcomeEvidence: String?
    public let reviewNote: String?
    public let reviewedAt: String?
    public let portfolioReviewBinding: PostDecisionPortfolioReviewBinding?
    public let reviewLearning: AnnualReviewLearningRequest?
    public let dailyTrackingBinding: ResearchReportDecisionBinding?

    public init(
        checkId: String,
        outcome: DecisionReviewOutcome,
        outcomeEvidence: String?,
        reviewNote: String?,
        reviewedAt: String?,
        portfolioReviewBinding: PostDecisionPortfolioReviewBinding? = nil,
        reviewLearning: AnnualReviewLearningRequest? = nil,
        dailyTrackingBinding: ResearchReportDecisionBinding? = nil
    ) {
        self.checkId = checkId
        self.outcome = outcome
        self.outcomeEvidence = outcomeEvidence
        self.reviewNote = reviewNote
        self.reviewedAt = reviewedAt
        self.portfolioReviewBinding = portfolioReviewBinding
        self.reviewLearning = reviewLearning
        self.dailyTrackingBinding = dailyTrackingBinding
    }
}

public struct PendingDecisionReviewSubmission: Equatable, Sendable {
    public let idempotencyKey: String
    public let fingerprint: DecisionReviewSubmissionFingerprint
    public let reservationId: UUID
}

public struct DecisionReviewSubmissionState {
    private var pending: PendingDecisionReviewSubmission?
    private var active: PendingDecisionReviewSubmission?
    private let makeIdempotencyKey: () -> String
    private let makeReservationId: () -> UUID

    public init(
        makeIdempotencyKey: @escaping () -> String = { UUID().uuidString },
        makeReservationId: @escaping () -> UUID = { UUID() }
    ) {
        self.makeIdempotencyKey = makeIdempotencyKey
        self.makeReservationId = makeReservationId
    }

    public var isInFlight: Bool {
        active != nil
    }

    public func isCurrent(_ submission: PendingDecisionReviewSubmission) -> Bool {
        active == submission && pending == submission
    }

    public mutating func begin(fingerprint: DecisionReviewSubmissionFingerprint) -> PendingDecisionReviewSubmission? {
        if active != nil { return nil }
        let idempotencyKey: String
        if let pending, pending.fingerprint == fingerprint {
            idempotencyKey = pending.idempotencyKey
        } else {
            idempotencyKey = makeIdempotencyKey()
        }
        let next = PendingDecisionReviewSubmission(
            idempotencyKey: idempotencyKey,
            fingerprint: fingerprint,
            reservationId: makeReservationId()
        )
        pending = next
        active = next
        return next
    }

    public mutating func invalidateContextPreservingRetry() {
        active = nil
    }

    public mutating func discardForAuthorizationChange() {
        active = nil
        pending = nil
    }

    @discardableResult
    public mutating func finishSuccessOrReplay(for submission: PendingDecisionReviewSubmission) -> Bool {
        guard isCurrent(submission) else { return false }
        active = nil
        pending = nil
        return true
    }

    @discardableResult
    public mutating func finishStaleSuccessPreservingRetry(
        for submission: PendingDecisionReviewSubmission
    ) -> Bool {
        finishFailurePreservingRetry(for: submission)
    }

    @discardableResult
    public mutating func finishAuthorizationChangeDiscarding(
        for submission: PendingDecisionReviewSubmission
    ) -> Bool {
        finishSuccessOrReplay(for: submission)
    }

    @discardableResult
    public mutating func finishFailurePreservingRetry(for submission: PendingDecisionReviewSubmission) -> Bool {
        guard isCurrent(submission) else { return false }
        active = nil
        return true
    }
}
