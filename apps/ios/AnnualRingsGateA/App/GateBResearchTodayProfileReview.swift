extension GateBResearchScreen {
    @MainActor
    func openResearchProfileReview(for membership: CandidateMembershipData) async {
        selectedEvidenceWorkspace = .research
        selectedResearchEditorPage = .profile
        isAnnualDecisionBriefResearchEditorExpanded = true
        annualDecisionBriefProfileDraftSource = nil
        pendingDecisionWorkspaceScrollTarget = "annualDecisionBriefResearchEditorAnchor"
        await prepareAnnualDecisionBriefEditor(for: membership)
    }
}
