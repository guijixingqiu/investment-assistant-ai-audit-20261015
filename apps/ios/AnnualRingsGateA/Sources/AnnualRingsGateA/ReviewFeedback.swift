import Foundation

public enum ReviewFeedbackKind: String, Equatable, Sendable {
    case reviewRequired = "review_required"
    case contextLimit = "context_limit"
    case evidenceConflict = "evidence_conflict"
    case evidenceGap = "evidence_gap"
    case historicalConcentration = "historical_concentration"
    case reviewComplete = "review_complete"
}

public struct ReviewFeedbackItem: Equatable, Identifiable, Sendable {
    public let kind: ReviewFeedbackKind
    public let title: String
    public let detail: String

    public var id: String { kind.rawValue }
}

public struct ReviewFeedbackCard: Equatable, Sendable {
    public enum State: String, Equatable, Sendable {
        case ready
        case unavailable
    }

    public let state: State
    public let title: String
    public let detail: String
    public let items: [ReviewFeedbackItem]

    public static func derive(
        state journeyState: CoreJourneyState,
        currentDecisionContext: DecisionContextEnvelope? = nil,
        submittedDecision: DecisionCheckData?,
        submittedReview: PostDecisionReviewData?,
        reviewHistory: DecisionReviewHistoryEnvelope?,
        pinganSnapshot: PinganSnapshotEnvelope?
    ) -> ReviewFeedbackCard {
        if let blocked = firstFailClosedStage(journeyState.stages) {
            return ReviewFeedbackCard(
                state: .unavailable,
                title: "复盘反馈不可用",
                detail: "仅作反思辅助。\(blocked.detail)",
                items: []
            )
        }

        guard let pair = selectReviewPair(
            symbol: journeyState.symbol,
            currentDecisionContext: currentDecisionContext,
            submittedDecision: submittedDecision,
            submittedReview: submittedReview,
            reviewHistory: reviewHistory
        ) else {
            return readyCard([
                item(.reviewRequired, "需要复盘", "仅作反思辅助。先完成人工检查和后续复盘，再展示有边界的反馈。")
            ])
        }

        var items: [ReviewFeedbackItem] = []
        if hasContextLimit(pair.snapshot) {
            items.append(item(.contextLimit, "历史上下文限制", "仅作反思辅助。记录的决策上下文为历史、不可用或已陈旧；不会重建缺失事实。"))
        }

        if let conflict = evidenceConflict(pair) {
            items.append(item(.evidenceConflict, "证据冲突", conflict))
        } else if let gap = evidenceGap(pair) {
            items.append(item(.evidenceGap, "证据缺口", gap))
        }

        if let concentration = historicalConcentration(symbol: journeyState.symbol, pinganSnapshot: pinganSnapshot) {
            items.append(item(.historicalConcentration, "历史集中度", concentration))
        }

        if items.isEmpty {
            items.append(item(.reviewComplete, "复盘完成", "仅作反思辅助。最新有边界复盘未触发上下文、证据或历史平安提示。"))
        }

        return readyCard(Array(items.prefix(3)))
    }

    private static func readyCard(_ items: [ReviewFeedbackItem]) -> ReviewFeedbackCard {
        ReviewFeedbackCard(
            state: .ready,
            title: "有边界复盘反馈",
            detail: "仅作反思辅助。本卡片只读，不会创建订单、交易、现金变动、费用、持仓变更、券商调用或组合事实。",
            items: items
        )
    }

    private struct Pair {
        let check: CheckLike
        let review: PostDecisionReviewData
        let snapshot: ContextSource?
    }

    private enum ContextSource {
        case current(DecisionContextEnvelope)
        case history(DecisionContextSnapshotState)
    }

    private struct CheckLike {
        let id: String
        let symbol: String
        let humanCheckResult: String
        let checkedAt: String
    }

    private static func selectReviewPair(
        symbol: String,
        currentDecisionContext: DecisionContextEnvelope?,
        submittedDecision: DecisionCheckData?,
        submittedReview: PostDecisionReviewData?,
        reviewHistory: DecisionReviewHistoryEnvelope?
    ) -> Pair? {
        if let submittedDecision,
           let submittedReview,
           submittedDecision.symbol == symbol,
           submittedReview.symbol == symbol,
           submittedReview.decisionCheckId == submittedDecision.id {
            let matchingContext = currentDecisionContext.flatMap { context in
                submittedDecision.decisionContextSchemaVersion == context.schemaVersion &&
                    submittedDecision.contextId == context.contextId &&
                    submittedDecision.contextHash == context.contextHash &&
                    context.requestedSymbol == submittedDecision.symbol ? context : nil
            }
            return Pair(
                check: CheckLike(
                    id: submittedDecision.id,
                    symbol: submittedDecision.symbol,
                    humanCheckResult: submittedDecision.humanCheckResult,
                    checkedAt: submittedDecision.checkedAt
                ),
                review: submittedReview,
                snapshot: matchingContext.map { .current($0) }
            )
        }

        var candidates: [Pair] = []
        for check in reviewHistory?.checks ?? [] where check.symbol == symbol {
            for review in check.reviews where review.decisionCheckId == check.id && review.symbol == check.symbol {
                candidates.append(Pair(
                    check: CheckLike(id: check.id, symbol: check.symbol, humanCheckResult: check.humanCheckResult, checkedAt: check.checkedAt),
                    review: review,
                    snapshot: .history(check.contextSnapshot)
                ))
            }
        }

        return candidates.sorted { left, right in
            if left.review.reviewedAt != right.review.reviewedAt { return left.review.reviewedAt > right.review.reviewedAt }
            if left.review.id != right.review.id { return left.review.id > right.review.id }
            if left.check.checkedAt != right.check.checkedAt { return left.check.checkedAt > right.check.checkedAt }
            return left.check.id > right.check.id
        }.first
    }

    private static func firstFailClosedStage(_ stages: [CoreJourneyStage]) -> CoreJourneyStage? {
        let severity: [CoreJourneyStageStatus] = [.malformed, .loading, .unauthorized, .conflict, .offlineError, .unavailable, .notFound]
        for status in severity {
            if let stage = stages.first(where: {
                $0.kind != .pinganHistoricalContext && $0.status == status
            }) {
                return stage
            }
        }
        return nil
    }

    private static func hasContextLimit(_ snapshot: ContextSource?) -> Bool {
        guard let snapshot else { return true }
        switch snapshot {
        case .current(let envelope):
            return hasDecisionContextLimit(envelope)
        case .history(let snapshot):
            guard snapshot.availability == .preserved, let envelope = snapshot.envelope else { return true }
            return hasDecisionContextLimit(envelope)
        }
    }

    private static func hasDecisionContextLimit(_ envelope: DecisionContextEnvelope?) -> Bool {
        guard let envelope else { return true }
        return envelope.quote.status != "fresh" || envelope.research.status != "available"
    }

    private static func evidenceConflict(_ pair: Pair) -> String? {
        if pair.review.outcome == .thesisWeakened || pair.review.outcome == .thesisInvalidated {
            return "仅作反思辅助。最新复盘结果为 \(pair.review.outcome.rawValue)，原始假设存在有边界的相反证据。"
        }
        if pair.review.outcome == .thesisConfirmed && pair.check.humanCheckResult == "blocked" {
            return "仅作反思辅助。最新复盘确认假设，但原人工检查为阻止状态；保留该冲突。"
        }
        return nil
    }

    private static func evidenceGap(_ pair: Pair) -> String? {
        if pair.review.outcome == .insufficientEvidence || pair.check.humanCheckResult == "needs_more_evidence" {
            return "仅作反思辅助。最新复盘或原人工检查记录了证据不足。"
        }
        return nil
    }

    private static func historicalConcentration(symbol: String, pinganSnapshot: PinganSnapshotEnvelope?) -> String? {
        guard let pinganSnapshot,
              (pinganSnapshot.status == .available || pinganSnapshot.status == .stale),
              pinganSnapshot.dataUse.display == "allowed_with_warning" else {
            return nil
        }
        let matches = pinganSnapshot.positions.filter { $0.symbol == symbol }
        guard matches.count == 1,
              let currentWeight = matches[0].currentWeight,
              let maxWeight = matches[0].maxWeight,
              currentWeight.isFinite,
              maxWeight.isFinite,
              currentWeight >= maxWeight else {
            return nil
        }
        return "仅作反思辅助。上次导入的历史平安行 \(matches[0].sourceRowId) 记录权重 \(formatPercent(currentWeight))，历史上限 \(formatPercent(maxWeight))，来源 as-of \(pinganSnapshot.sourceAsOf ?? "unknown")。"
    }

    private static func item(_ kind: ReviewFeedbackKind, _ title: String, _ detail: String) -> ReviewFeedbackItem {
        ReviewFeedbackItem(kind: kind, title: title, detail: detail)
    }

    private static func formatPercent(_ value: Double) -> String {
        String(format: "%.2f%%", value * 100)
    }
}
