import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func loadComparedDecisionReviewHistory() async {
        guard let current = selectedMembership,
              let targetId = comparedDecisionReviewMembershipId,
              let target = candidateMemberships.memberships.first(where: {
                  $0.id == targetId
                      && $0.actorId == current.actorId
                      && $0.symbol != current.symbol
                      && $0.state != .archived
              }) else {
            comparedDecisionReviewHistory = nil
            comparedDecisionReviewMessage = "请选择另一只当前可读的研究股票。"
            return
        }
        let requestId = UUID()
        let authorizationRevision = viewModel.authorizationRevision
        let currentIdentity = ResearchDocumentOperationIdentity(membership: current)
        let targetIdentity = ResearchDocumentOperationIdentity(membership: target)
        comparedDecisionReviewRequestId = requestId
        isLoadingComparedDecisionReviewHistory = true
        comparedDecisionReviewHistory = nil
        comparedDecisionReviewMessage = "正在读取 \(target.symbol) 的决定与复盘历史…"
        defer {
            if comparedDecisionReviewRequestId == requestId {
                isLoadingComparedDecisionReviewHistory = false
            }
        }
        do {
            let history = try await client.fetchDecisionReviewHistory(
                market: target.market,
                code: target.code
            )
            guard comparedDecisionReviewRequestId == requestId,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  currentIdentity.matches(membership: selectedMembership),
                  candidateMemberships.memberships.contains(where: {
                      targetIdentity.matches(membership: $0)
                  }) else { return }
            guard ["fresh", "missing"].contains(history.metadata.freshness) else {
                comparedDecisionReviewHistory = nil
                comparedDecisionReviewMessage = "对比股票历史来源不可用；未显示旧历史，也未把失败当作无记录。"
                return
            }
            comparedDecisionReviewHistory = history
            comparedDecisionReviewMessage = history.metadata.freshness == "fresh"
                ? "已读取 \(target.symbol) 的 fresh exact 历史。"
                : "已 fresh-read \(target.symbol)；当前没有已记录的决定或复盘历史。"
        } catch {
            guard comparedDecisionReviewRequestId == requestId else { return }
            comparedDecisionReviewHistory = nil
            comparedDecisionReviewMessage = "对比股票历史读取失败；未显示旧历史，也未把失败当作无记录。"
        }
    }
}
