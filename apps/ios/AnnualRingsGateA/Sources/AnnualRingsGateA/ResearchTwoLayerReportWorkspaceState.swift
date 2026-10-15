import Foundation

struct TwoLayerReportBindingIdentity: Equatable, Sendable {
    let membershipId: String
    let membershipVersion: Int
    let membershipState: String
    let symbol: String
    let evidencePackId: String?
    let packFingerprint: String?
    let packCurrentnessStatus: String?
    let packInvalidatedBy: [String]

    init(
        membership: CandidateMembershipData,
        pack: FrozenResearchEvidencePack?
    ) {
        membershipId = membership.id
        membershipVersion = membership.version
        membershipState = membership.state.rawValue
        symbol = membership.symbol
        evidencePackId = pack?.id
        packFingerprint = pack?.packFingerprint
        packCurrentnessStatus = pack?.currentness.status
        packInvalidatedBy = pack?.currentness.invalidatedBy ?? []
    }
}

struct TwoLayerReportWorkspaceState {
    enum RetryAction: Equatable {
        case load
        case synthesis
        case absorption
    }

    var envelope: FrozenResearchEvidenceWorkspace?
    var draft: TwoLayerEditableDraft?
    var requests = TwoLayerReportRequestLanes()
    var bindingIdentity: TwoLayerReportBindingIdentity?
    var saveReservation = ResearchDocumentIdempotencyReservation()
    var retryReservation = ResearchDocumentIdempotencyReservation()
    var absorptionReservation = ResearchDocumentIdempotencyReservation()
    var cancellationReservation = ResearchDocumentIdempotencyReservation()
    var decisionReservation = ResearchDocumentIdempotencyReservation()
    var deletionReservation = ResearchDocumentIdempotencyReservation()
    var pendingDeletionReportId: String?
    var pendingSynthesisTask: DeepResearchTaskEnvelope.Task?
    var synthesisTaskLastReadAt: Date?
    var isRefreshingSynthesisTask = false
    var synthesisTaskAutoRefreshPaused = false
    var synthesisTaskAutoRefreshRevision: UInt64 = 0
    var pendingWriteId: String?
    var failureMessage: String?
    var retryAction: RetryAction?
    var message = "Fresh GET 当前 evidence pack 后创建可编辑填写框架。"

    var isBusy: Bool { requests.isBusy || isRefreshingSynthesisTask }
    var isStaleRead: Bool { envelope != nil && retryAction == .load }
    var hasActiveSynthesisTask: Bool {
        pendingSynthesisTask.map {
            ["pending", "running", "ready_to_absorb"].contains($0.status)
        } ?? false
    }

    mutating func synchronize(
        _ identity: TwoLayerReportBindingIdentity?,
        message: String
    ) {
        guard bindingIdentity != identity else { return }
        clear(message)
        bindingIdentity = identity
    }

    mutating func clear(_ message: String) {
        envelope = nil
        draft = nil
        requests.reset()
        saveReservation.clear()
        retryReservation.clear()
        absorptionReservation.clear()
        cancellationReservation.clear()
        decisionReservation.clear()
        deletionReservation.clear()
        pendingDeletionReportId = nil
        pendingSynthesisTask = nil
        synthesisTaskLastReadAt = nil
        isRefreshingSynthesisTask = false
        synthesisTaskAutoRefreshPaused = false
        synthesisTaskAutoRefreshRevision = 0
        pendingWriteId = nil
        failureMessage = nil
        retryAction = nil
        self.message = message
    }

    mutating func clearFailure() {
        failureMessage = nil
        retryAction = nil
    }

    mutating func fail(_ action: RetryAction, message: String) {
        failureMessage = message
        retryAction = action
        self.message = message
    }

    mutating func preserveAmbiguousWrite(
        previousEnvelope: FrozenResearchEvidenceWorkspace?,
        message: String,
        action: RetryAction = .synthesis
    ) {
        envelope = previousEnvelope
        pendingWriteId = nil
        fail(action, message: message)
    }

    mutating func preserveReadFailure(
        previousEnvelope: FrozenResearchEvidenceWorkspace,
        message: String
    ) {
        envelope = previousEnvelope
        pendingWriteId = nil
        fail(.load, message: message)
    }

    mutating func preserveAmbiguousDecision(
        previousEnvelope: FrozenResearchEvidenceWorkspace?,
        message: String
    ) {
        envelope = previousEnvelope
        self.message = message
    }
}
