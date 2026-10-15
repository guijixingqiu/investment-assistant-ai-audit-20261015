import SwiftUI

extension GateBResearchScreen {
    var requestState: GateBResearchRequestState {
        get { viewModel.requestState }
        nonmutating set { viewModel.requestState = newValue }
    }

    var isLoadingCandidates: Bool { requestState.isLoadingCandidates }

    var isLoadingMobileWorkspace: Bool {
        dailyRefreshGate.phase == .refreshing ||
            dailyRefreshGate.phase == .validatingRestoredNavigation ||
            isRefreshingResearchTechnicalEvidence ||
            isWritingAnnualDecisionBriefResearch ||
            isLoadingMemberships ||
            isLoadingDecisionIntake ||
            isLoadingDecisionBrief ||
            isLoadingValuationQuant ||
            isLoadingAdvisoryScope ||
            isLoadingHumanReviewWorkspace ||
            isLoadingReviewFollowUpWorkflow ||
            isLoadingDecisionNoteWorkflow ||
            researchDocumentWorkspace.isBusy ||
            researchFundamentalWorkspace.isBusy ||
            researchContextWorkspace.isBusy ||
            researchValuationScenarioWorkspace.isBusy ||
            frozenResearchEvidenceWorkspace.isBusy ||
            isLoadingTodayResearch ||
            isLoadingDecisionReviewHistory ||
            isLoadingPortfolioLab ||
            isLoadingPortfolioReportExplanation ||
            isLoadingConditionalDecisionPreview ||
            isLoading
    }
}
