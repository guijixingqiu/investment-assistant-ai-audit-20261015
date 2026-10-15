import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func decisionBriefCandidateActions(_ membership: CandidateMembershipData) -> some View {
        Button {
            selectMembershipForAction(membership, layer: .evidence)
            selectedEvidenceWorkspace = .research
            selectedResearchEditorPage = .profile
            isAnnualDecisionBriefResearchEditorExpanded = true
            annualDecisionBriefProfileDraftSource = nil
            pendingDecisionWorkspaceScrollTarget = "annualDecisionBriefResearchEditorAnchor"
            Task { await prepareAnnualDecisionBriefEditor(for: membership) }
        } label: {
            Label("维护研究事实", systemImage: "square.and.pencil")
        }
        .buttonStyle(.bordered)
        .disabled(isWritingAnnualDecisionBriefResearch || membership.state == .archived)
        .accessibilityIdentifier("annualDecisionBriefEdit-\(membership.symbol)")

        Button {
            isAnnualDecisionBriefResearchEditorExpanded = false
            isAnnualDecisionBriefExpanded = true
            selectedEvidenceWorkspace = .brief
            let symbolWillChange = parsedSymbol?.canonical != membership.symbol
            selectMembershipForAction(membership, layer: .evidence)
            pendingDecisionBriefMembershipAfterSymbolChange = symbolWillChange ? membership : nil
            if !symbolWillChange {
                Task { await loadAnnualDecisionBrief(for: membership) }
            }
        } label: {
            Label(isLoadingDecisionBrief ? "读取中" : "读取每日决策简报", systemImage: "doc.text.image")
        }
        .buttonStyle(.borderedProminent)
        .disabled(isLoadingDecisionBrief || isWritingAnnualDecisionBriefResearch)
        .accessibilityIdentifier("annualDecisionBriefLoad-\(membership.symbol)")
    }
}
