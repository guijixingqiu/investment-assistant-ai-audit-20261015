import Foundation

public struct GateBResearchRequestState: Equatable {
    public private(set) var candidateRequestId = UUID()
    public private(set) var membershipRequestId = UUID()
    public private(set) var membershipWriteRequestId = UUID()
    public private(set) var decisionIntakeRequestId = UUID()
    public private(set) var decisionBriefRequestId = UUID()
    public private(set) var valuationQuantRequestId = UUID()
    public private(set) var advisoryScopeRequestId = UUID()
    public private(set) var humanReviewWorkspaceRequestId = UUID()
    public private(set) var reviewFollowUpWorkflowRequestId = UUID()
    public private(set) var decisionNoteWorkflowRequestId = UUID()
    public private(set) var researchProfileRequestId = UUID()
    public private(set) var decisionContextRequestId = UUID()
    public private(set) var pinganSnapshotRequestId = UUID()
    public private(set) var decisionReviewHistoryRequestId = UUID()
    public private(set) var journeyRequestId = UUID()
    public private(set) var isLoadingCandidates = false
    public private(set) var isLoadingMemberships = false
    public private(set) var isWritingMembership = false
    public private(set) var isLoadingDecisionIntake = false
    public private(set) var isLoadingDecisionBrief = false
    public private(set) var isLoadingValuationQuant = false
    public private(set) var isLoadingAdvisoryScope = false
    public private(set) var isLoadingHumanReviewWorkspace = false
    public private(set) var isLoadingReviewFollowUpWorkflow = false
    public private(set) var isLoadingDecisionNoteWorkflow = false
    public private(set) var isLoadingResearchProfile = false
    public private(set) var isLoadingDecisionContext = false
    public private(set) var isLoadingPinganSnapshot = false
    public private(set) var isLoadingDecisionReviewHistory = false
    public private(set) var isLoadingJourney = false

    public init() {}

    public mutating func beginCandidateLoad(id: UUID = UUID()) -> UUID {
        candidateRequestId = id
        isLoadingCandidates = true
        return id
    }

    public mutating func beginMembershipLoad(id: UUID = UUID()) -> UUID {
        membershipRequestId = id
        isLoadingMemberships = true
        return id
    }

    public mutating func beginMembershipWrite(id: UUID = UUID()) -> UUID {
        membershipWriteRequestId = id
        isWritingMembership = true
        return id
    }

    public mutating func beginDecisionIntakeLoad(id: UUID = UUID()) -> UUID {
        decisionIntakeRequestId = id
        isLoadingDecisionIntake = true
        return id
    }

    public mutating func beginDecisionBriefLoad(id: UUID = UUID()) -> UUID {
        decisionBriefRequestId = id
        isLoadingDecisionBrief = true
        return id
    }

    public mutating func beginValuationQuantLoad(id: UUID = UUID()) -> UUID {
        valuationQuantRequestId = id
        isLoadingValuationQuant = true
        return id
    }

    public mutating func beginAdvisoryScopeLoad(id: UUID = UUID()) -> UUID {
        advisoryScopeRequestId = id
        isLoadingAdvisoryScope = true
        return id
    }

    public mutating func beginHumanReviewWorkspaceLoad(id: UUID = UUID()) -> UUID {
        humanReviewWorkspaceRequestId = id
        isLoadingHumanReviewWorkspace = true
        return id
    }

    public mutating func beginReviewFollowUpWorkflowLoad(id: UUID = UUID()) -> UUID {
        reviewFollowUpWorkflowRequestId = id
        isLoadingReviewFollowUpWorkflow = true
        return id
    }

    public mutating func beginDecisionNoteWorkflowLoad(id: UUID = UUID()) -> UUID {
        decisionNoteWorkflowRequestId = id
        isLoadingDecisionNoteWorkflow = true
        return id
    }

    public mutating func beginResearchProfileLoad(id: UUID = UUID()) -> UUID {
        researchProfileRequestId = id
        isLoadingResearchProfile = true
        return id
    }

    public mutating func beginDecisionContextLoad(id: UUID = UUID()) -> UUID {
        decisionContextRequestId = id
        isLoadingDecisionContext = true
        return id
    }

    public mutating func beginPinganSnapshotLoad(id: UUID = UUID()) -> UUID {
        pinganSnapshotRequestId = id
        isLoadingPinganSnapshot = true
        return id
    }

    public mutating func beginDecisionReviewHistoryLoad(id: UUID = UUID()) -> UUID {
        decisionReviewHistoryRequestId = id
        isLoadingDecisionReviewHistory = true
        return id
    }

    public mutating func beginJourneyLoad(id: UUID = UUID()) -> UUID {
        journeyRequestId = id
        researchProfileRequestId = id
        decisionContextRequestId = id
        pinganSnapshotRequestId = id
        decisionReviewHistoryRequestId = id
        isLoadingJourney = true
        isLoadingResearchProfile = true
        isLoadingDecisionContext = true
        isLoadingPinganSnapshot = true
        isLoadingDecisionReviewHistory = true
        return id
    }

    public func isCurrentCandidateLoad(_ id: UUID) -> Bool {
        candidateRequestId == id
    }

    public func isCurrentMembershipLoad(_ id: UUID) -> Bool {
        membershipRequestId == id
    }

    public func isCurrentMembershipWrite(_ id: UUID) -> Bool {
        membershipWriteRequestId == id
    }

    public func isCurrentDecisionIntakeLoad(_ id: UUID) -> Bool {
        decisionIntakeRequestId == id
    }

    public func isCurrentDecisionBriefLoad(_ id: UUID) -> Bool {
        decisionBriefRequestId == id
    }

    public func isCurrentValuationQuantLoad(_ id: UUID) -> Bool {
        valuationQuantRequestId == id
    }

    public func isCurrentAdvisoryScopeLoad(_ id: UUID) -> Bool {
        advisoryScopeRequestId == id
    }

    public func isCurrentHumanReviewWorkspaceLoad(_ id: UUID) -> Bool {
        humanReviewWorkspaceRequestId == id
    }

    public func isCurrentReviewFollowUpWorkflowLoad(_ id: UUID) -> Bool {
        reviewFollowUpWorkflowRequestId == id
    }

    public func isCurrentDecisionNoteWorkflowLoad(_ id: UUID) -> Bool {
        decisionNoteWorkflowRequestId == id
    }

    public func isCurrentResearchProfileLoad(_ id: UUID) -> Bool {
        researchProfileRequestId == id
    }

    public func isCurrentDecisionContextLoad(_ id: UUID) -> Bool {
        decisionContextRequestId == id
    }

    public func isCurrentPinganSnapshotLoad(_ id: UUID) -> Bool {
        pinganSnapshotRequestId == id
    }

    public func isCurrentDecisionReviewHistoryLoad(_ id: UUID) -> Bool {
        decisionReviewHistoryRequestId == id
    }

    public func isCurrentJourneyLoad(_ id: UUID) -> Bool {
        journeyRequestId == id
    }

    public mutating func finishCandidateLoad(id: UUID) {
        guard candidateRequestId == id else { return }
        isLoadingCandidates = false
    }

    public mutating func finishMembershipLoad(id: UUID) {
        guard membershipRequestId == id else { return }
        isLoadingMemberships = false
    }

    public mutating func finishMembershipWrite(id: UUID) {
        guard membershipWriteRequestId == id else { return }
        isWritingMembership = false
    }

    public mutating func finishDecisionIntakeLoad(id: UUID) {
        guard decisionIntakeRequestId == id else { return }
        isLoadingDecisionIntake = false
    }

    public mutating func finishDecisionBriefLoad(id: UUID) {
        guard decisionBriefRequestId == id else { return }
        isLoadingDecisionBrief = false
    }

    public mutating func finishValuationQuantLoad(id: UUID) {
        guard valuationQuantRequestId == id else { return }
        isLoadingValuationQuant = false
    }

    public mutating func finishAdvisoryScopeLoad(id: UUID) {
        guard advisoryScopeRequestId == id else { return }
        isLoadingAdvisoryScope = false
    }

    public mutating func finishHumanReviewWorkspaceLoad(id: UUID) {
        guard humanReviewWorkspaceRequestId == id else { return }
        isLoadingHumanReviewWorkspace = false
    }

    public mutating func finishReviewFollowUpWorkflowLoad(id: UUID) {
        guard reviewFollowUpWorkflowRequestId == id else { return }
        isLoadingReviewFollowUpWorkflow = false
    }

    public mutating func finishDecisionNoteWorkflowLoad(id: UUID) {
        guard decisionNoteWorkflowRequestId == id else { return }
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func finishResearchProfileLoad(id: UUID) {
        guard researchProfileRequestId == id else { return }
        isLoadingResearchProfile = false
    }

    public mutating func finishDecisionContextLoad(id: UUID) {
        guard decisionContextRequestId == id else { return }
        isLoadingDecisionContext = false
    }

    public mutating func finishPinganSnapshotLoad(id: UUID) {
        guard pinganSnapshotRequestId == id else { return }
        isLoadingPinganSnapshot = false
    }

    public mutating func finishDecisionReviewHistoryLoad(id: UUID) {
        guard decisionReviewHistoryRequestId == id else { return }
        isLoadingDecisionReviewHistory = false
    }

    public mutating func finishJourneyLoad(id: UUID) {
        guard journeyRequestId == id else { return }
        isLoadingJourney = false
        isLoadingResearchProfile = false
        isLoadingDecisionContext = false
        isLoadingPinganSnapshot = false
        if decisionReviewHistoryRequestId == id {
            isLoadingDecisionReviewHistory = false
        }
    }

    public mutating func cancelJourneyLoad(id: UUID = UUID()) {
        journeyRequestId = id
        researchProfileRequestId = id
        decisionContextRequestId = id
        pinganSnapshotRequestId = id
        decisionReviewHistoryRequestId = id
        isLoadingJourney = false
        isLoadingResearchProfile = false
        isLoadingDecisionContext = false
        isLoadingPinganSnapshot = false
        isLoadingDecisionReviewHistory = false
    }

    public mutating func cancelDecisionIntakePath(id: UUID = UUID()) {
        decisionIntakeRequestId = id
        decisionBriefRequestId = id
        valuationQuantRequestId = id
        advisoryScopeRequestId = id
        humanReviewWorkspaceRequestId = id
        reviewFollowUpWorkflowRequestId = id
        decisionNoteWorkflowRequestId = id
        isLoadingDecisionIntake = false
        isLoadingDecisionBrief = false
        isLoadingValuationQuant = false
        isLoadingAdvisoryScope = false
        isLoadingHumanReviewWorkspace = false
        isLoadingReviewFollowUpWorkflow = false
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func cancelDecisionBriefLoad(id: UUID = UUID()) {
        decisionBriefRequestId = id
        isLoadingDecisionBrief = false
    }

    public mutating func cancelValuationQuantLoad(id: UUID = UUID()) {
        valuationQuantRequestId = id
        isLoadingValuationQuant = false
    }

    public mutating func cancelAdvisoryScopePath(id: UUID = UUID()) {
        advisoryScopeRequestId = id
        humanReviewWorkspaceRequestId = id
        reviewFollowUpWorkflowRequestId = id
        decisionNoteWorkflowRequestId = id
        isLoadingAdvisoryScope = false
        isLoadingHumanReviewWorkspace = false
        isLoadingReviewFollowUpWorkflow = false
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func cancelHumanReviewWorkspacePath(id: UUID = UUID()) {
        humanReviewWorkspaceRequestId = id
        reviewFollowUpWorkflowRequestId = id
        decisionNoteWorkflowRequestId = id
        isLoadingHumanReviewWorkspace = false
        isLoadingReviewFollowUpWorkflow = false
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func cancelReviewFollowUpWorkflowPath(id: UUID = UUID()) {
        reviewFollowUpWorkflowRequestId = id
        decisionNoteWorkflowRequestId = id
        isLoadingReviewFollowUpWorkflow = false
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func cancelDecisionNoteWorkflowLoad(id: UUID = UUID()) {
        decisionNoteWorkflowRequestId = id
        isLoadingDecisionNoteWorkflow = false
    }

    public mutating func invalidateAll() {
        self = GateBResearchRequestState()
    }
}
