import SwiftUI

extension TodayActionInboxCard {
    init(
        refreshRevision: UInt64, fallbackSymbol: String?,
        client: any TodayActionInboxFetching = ResearchClient(
            baseURL: AppEnvironment.baseURL(),
            authToken: AppEnvironment.authToken(),
            authHeaderName: AppEnvironment.authHeaderName(),
            writeAuthToken: AppEnvironment.writeAuthToken(),
            writeAuthHeaderName: AppEnvironment.writeAuthHeaderName()
        ),
        openResearch: @escaping (String) -> Void,
        openMarket: @escaping (String?) -> Void,
        openAssets: @escaping () -> Void,
        openResearchCandidate: @escaping (TodayCandidateNavigationTarget) -> Void,
        openResearchToday: @escaping (TodayResearchNavigationTarget) -> Void,
        openResearchReview: @escaping (TodayReviewNavigationTarget) -> Void,
        openResearchFormalDecision: @escaping (TodayFormalDecisionNavigationTarget) -> Void
    ) {
        self.refreshRevision = refreshRevision; self.fallbackSymbol = fallbackSymbol
        self.client = client
        self.openResearch = openResearch
        self.openMarket = openMarket
        self.openAssets = openAssets
        self.openResearchCandidate = openResearchCandidate
        self.openResearchToday = openResearchToday
        self.openResearchReview = openResearchReview
        self.openResearchFormalDecision = openResearchFormalDecision
    }

    @MainActor
    func load() async {
        generation += 1; let ticket = generation; isLoading = true
        defer { if ticket == generation { isLoading = false } }
        let loaded = await client.fetchTodayActionInbox()
        guard ticket == generation, !Task.isCancelled else { return }
        let previous = envelope
        if [TodayActionInboxStatus.available, .empty].contains(previous.status),
           [TodayActionInboxStatus.unavailable, .unauthorized].contains(loaded.status) {
            readIssue = "刷新失败；已撤销上次读取结果，不能沿用旧待办处置；请重试后再操作。"
        } else {
            readIssue = nil
        }
        envelope = loaded
        openPendingNotification(in: loaded)
    }
}
