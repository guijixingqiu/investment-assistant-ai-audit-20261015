import Foundation

extension GateBResearchScreen {
    @MainActor
    func scheduleResearchArchiveAutomaticBackup(
        _ trigger: ResearchArchiveAutomaticBackupTrigger,
        membership expectedMembership: CandidateMembershipData
    ) {
        guard researchArchiveAutomaticBackupIsEnabled(),
              selectedMembership?.id == expectedMembership.id,
              selectedMembership?.version == expectedMembership.version,
              selectedMembership?.symbol == expectedMembership.symbol else { return }
        Task { @MainActor in
            do {
                let originalPDFs = try await currentResearchArchiveOriginalPDFs()
                let originalHTMLs = try await currentResearchArchiveOriginalHTMLs()
                guard selectedMembership?.id == expectedMembership.id,
                      selectedMembership?.version == expectedMembership.version,
                      selectedMembership?.symbol == expectedMembership.symbol,
                      let archive = currentResearchArchiveExport(
                        includeTemporaryConversation: false
                      ) else { return }
                _ = try writeResearchArchiveAutomaticBackup(
                    archive,
                    membership: expectedMembership,
                    trigger: trigger,
                    originalPDFs: originalPDFs,
                    originalHTMLs: originalHTMLs
                )
            } catch {
                guard selectedMembership?.id == expectedMembership.id,
                      selectedMembership?.version == expectedMembership.version,
                      selectedMembership?.symbol == expectedMembership.symbol else { return }
                recordResearchArchiveAutomaticBackupFailure(
                    membership: expectedMembership,
                    trigger: trigger
                )
            }
        }
    }
}
