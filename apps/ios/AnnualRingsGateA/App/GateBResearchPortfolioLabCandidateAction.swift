import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func annualPortfolioLabCandidateAction(_ membership: CandidateMembershipData) -> some View {
        Button {
            selectMembershipForAction(membership, layer: .portfolio)
            selectedPortfolioWorkspace = .lab
            pendingDecisionWorkspaceScrollTarget = "annualPortfolioLabAnchor"
        } label: {
            Label("打开组合实验室", systemImage: "rectangle.split.3x1")
        }
        .buttonStyle(.bordered)
        .disabled(membership.state == .archived)
        .accessibilityIdentifier("annualPortfolioLabOpen-\(membership.symbol)")
    }
}
