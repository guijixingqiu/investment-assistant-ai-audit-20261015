import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func createMembership() async -> CandidateMembershipData? {
        if viewModel.refreshRuntimeAuthorizationIfNeeded() {
            invalidateDailyClientForAuthorizationChange()
            await refreshDailyClient(restoredNavigation: false, preferredMembership: nil)
            return nil
        }
        guard let symbol = SecuritySymbol.parseHongKongAlias(membershipInput) else {
            membershipWriteMessage = "仅支持形如 00700、00175.hk 或 HK.00175 的香港五位数字代码。"
            return nil
        }
        let fingerprint = CandidateMembershipSubmissionFingerprint(
            operation: "create",
            membershipId: nil,
            code: symbol.code,
            currentVersion: nil,
            targetState: membershipInitialState == .tracked ? .tracked : .paused,
            restoreArchived: restoreArchivedMembership
        )
        guard let submission = membershipSubmissionState.begin(fingerprint: fingerprint) else {
            return nil
        }
        membershipWriteMessage = nil
        membershipStaleMessage = nil
        let writeId = requestState.beginMembershipWrite()
        defer { requestState.finishMembershipWrite(id: writeId) }

        do {
            let response = try await client.createCandidateMembership(
                request: CreateCandidateMembershipRequest(
                    market: symbol.market,
                    code: symbol.code,
                    initialState: membershipInitialState,
                    restoreArchived: restoreArchivedMembership,
                    idempotencyKey: submission.idempotencyKey
                )
            )
            guard requestState.isCurrentMembershipWrite(writeId) else { return nil }
            membershipSubmissionState.finishSuccessOrReplay()
            membershipWriteMessage = response.message
            membershipInput = ""
            restoreArchivedMembership = false
            todayRefreshRevision &+= 1
            await refreshMemberships()
            return response.data
        } catch {
            guard requestState.isCurrentMembershipWrite(writeId) else { return nil }
            membershipSubmissionState.finishFailurePreservingRetry()
            await applyMembershipWriteFailure(error, operation: .create)
            return nil
        }
    }

    @MainActor
    func updateMembership(_ membership: CandidateMembershipData, state: CandidateMembershipState) async {
        let fingerprint = CandidateMembershipSubmissionFingerprint(
            operation: "state",
            membershipId: membership.id,
            code: membership.code,
            currentVersion: membership.version,
            targetState: state,
            restoreArchived: state != .archived
        )
        guard let submission = membershipSubmissionState.begin(fingerprint: fingerprint) else {
            return
        }
        membershipWriteMessage = nil
        membershipStaleMessage = nil
        let writeId = requestState.beginMembershipWrite()
        defer { requestState.finishMembershipWrite(id: writeId) }

        do {
            let response = try await client.updateCandidateMembershipState(
                id: membership.id,
                request: UpdateCandidateMembershipStateRequest(
                    state: state,
                    version: membership.version,
                    idempotencyKey: submission.idempotencyKey
                )
            )
            guard requestState.isCurrentMembershipWrite(writeId) else { return }
            membershipSubmissionState.finishSuccessOrReplay()
            membershipWriteMessage = response.message
            todayRefreshRevision &+= 1
            await refreshMemberships()
        } catch {
            guard requestState.isCurrentMembershipWrite(writeId) else { return }
            membershipSubmissionState.finishFailurePreservingRetry()
            await applyMembershipWriteFailure(error, operation: .update)
        }
    }

    @MainActor
    func applyMembershipWriteFailure(_ error: Error, operation: CandidateMembershipWriteOperation) async {
        let failure = candidateMembershipWriteFailurePresentation(for: error, operation: operation)
        if failure.usesStaleMessage {
            membershipStaleMessage = failure.message
        } else {
            membershipWriteMessage = failure.message
        }
        if failure.refreshesMemberships {
            await refreshMemberships()
        }
    }
}
