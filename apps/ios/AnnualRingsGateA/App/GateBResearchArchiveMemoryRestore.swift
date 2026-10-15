import Foundation

extension GateBResearchScreen {
    @MainActor
    func restoreLocalMemoryFromResearchArchive(_ archive: RestoredResearchArchive) throws {
        guard let membership = selectedMembership,
              archive.preview.matches(membership),
              let currentIdentity = currentReviewKnowledgeIdentity(),
              currentIdentity.sourceSignature == currentLocalRecordSourceSignature(),
              let protection = currentResearchArchiveExport() else {
            throw ResearchArchiveExportError.invalidArchive
        }
        _ = try restoreResearchArchive(protection.data, membership: membership)
        let restored = try restoreResearchArchiveLocalMemory(
            archive,
            membership: membership,
            currentIdentity: currentIdentity,
            localDefaults: viewModel.localDefaults,
            knowledgeStorage: viewModel.reviewKnowledgeStorage,
            currentReport: currentResearchEvidenceQuestionReport
        )
        if let recordId = restored.localRecordId {
            loadLocalRecord(sourceSignature: currentIdentity.sourceSignature)
            guard localRecordEnvelopeId == recordId else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if restored.localRecordDeleted {
            loadLocalRecord(sourceSignature: currentIdentity.sourceSignature)
            guard localRecordEnvelopeId == nil,
                  viewModel.localDefaults.string(
                    forKey: GateBLocalRecordStorage.deletionKey(currentIdentity.sourceSignature)
                  ) != nil else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if restored.knowledgeCount > 0 {
            guard loadReviewKnowledgeForSelectedCandidate(),
                  reviewKnowledgeEntries.count == restored.knowledgeCount else {
                throw ResearchArchiveExportError.invalidArchive
            }
        }
        if restored.temporaryConversationRestored {
            guard let report = currentResearchEvidenceQuestionReport,
                  let snapshot = try loadResearchTemporaryConversation(
                    membership: membership,
                    report: report,
                    defaults: viewModel.localDefaults
                  ) else {
                throw ResearchArchiveExportError.invalidArchive
            }
            viewModel.researchEvidenceQuestionConversation = snapshot.responses.map { .init(response: $0) }
            viewModel.researchEvidenceQuestionSessionId = snapshot.sessionId
            viewModel.researchEvidenceQuestionCarrySummary = snapshot.carrySummary
            viewModel.researchEvidenceQuestionCarryFromSessionId = snapshot.carryFromSessionId
            viewModel.researchEvidenceQuestionConversationIdentity =
                researchTemporaryConversationIdentity(membership: membership, report: report)
            viewModel.researchEvidenceQuestionClearMarker =
                researchTemporaryConversationClearMarker(defaults: viewModel.localDefaults)
            viewModel.researchEvidenceQuestionHistory = try listResearchTemporaryConversations(
                membership: membership, report: report, defaults: viewModel.localDefaults
            )
            viewModel.researchEvidenceQuestionResponse = snapshot.responses.last
            viewModel.researchEvidenceQuestion = snapshot.questionDraft
            viewModel.researchEvidenceQuestionCorrection = snapshot.correctionDraft
        }
    }
}
