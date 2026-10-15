import SwiftUI

extension GateBResearchScreen {
    func researchStatusLabel(_ value: String) -> String {
        switch value {
        case "available", "current", "ready", "fresh": "已更新"
        case "empty", "missing", "not_found": "暂无记录"
        case "stale": "需要刷新"
        case "partial": "部分可用"
        case "conflict", "source_conflict": "数据冲突"
        case "unauthorized": "未授权"
        default: "暂不可用"
        }
    }

    func coreJourneyActionLabel(_ value: CoreJourneyNextActionKind) -> String {
        switch value {
        case .fixSymbol: "修正股票"
        case .waitForLoad: "等待读取"
        case .reauthenticate: "补充授权"
        case .resolveConflict: "处理冲突"
        case .retryLoad: "重新读取"
        case .refreshQuote: "刷新行情"
        case .refreshResearch: "刷新研究"
        case .continueWithPinganLimitation: "按当前资产边界继续"
        case .submitHumanCheck: "提交人工决定"
        case .submitReview: "提交复盘"
        case .journeyComplete: "当前流程已完成"
        }
    }

    func coreJourneyOperationLabel(_ value: CoreJourneyOperation) -> String {
        switch value {
        case .load: "读取"
        case .decision: "决定"
        case .review: "复盘"
        case .none: "无需操作"
        }
    }

    func factKindLabel(_ value: FactKind) -> String { value == .fact ? "事实" : "推断" }
    func evidenceStanceLabel(_ value: EvidenceStance) -> String {
        switch value { case .support: "支持"; case .refute: "反证"; case .neutral: "中性" }
    }
    func suggestionStatusLabel(_ value: SuggestionStatus) -> String {
        switch value { case .pending: "待处理"; case .accepted: "已接受"; case .rejected: "已拒绝" }
    }
    func pinganSnapshotStatusLabel(_ value: PinganSnapshotStatus) -> String { researchStatusLabel(value.rawValue) }

    func quoteStatusText(_ quote: DecisionContextQuote) -> String {
        [researchStatusLabel(quote.status), quote.message, quote.staleReason.map { "原因：\($0)" }]
            .compactMap { $0 }
            .joined(separator: "：")
    }

    func candidateQuoteText(_ quote: CandidateOverviewQuoteState) -> String {
        [researchStatusLabel(quote.status.rawValue), assetsQuoteSourceLabel(quote.source), quote.fetchedAt, quote.staleReason.map { "原因：\($0)" }]
            .compactMap { $0 }
            .joined(separator: "：")
    }

    func candidateMembershipResearchText(_ membership: CandidateMembershipData) -> String {
        [researchStatusLabel(membership.research.status.rawValue), membership.research.profileUpdatedAt, membership.research.name]
            .compactMap { $0 }
            .joined(separator: "：")
    }

    func candidateMembershipQuoteText(_ quote: CandidateMembershipQuoteState) -> String {
        [researchStatusLabel(quote.status.rawValue), assetsQuoteSourceLabel(quote.source), quote.fetchedAt, quote.staleReason.map { "原因：\($0)" }]
            .compactMap { $0 }
            .joined(separator: "：")
    }

    func candidateMembershipSafetyText(_ safety: CandidateMembershipSafety) -> String {
        safetyText(
            createsOrder: safety.createsOrder,
            createsTrade: safety.createsTrade,
            mutatesCash: safety.mutatesCash,
            writesFee: safety.writesFee,
            mutatesPosition: safety.mutatesPosition,
            callsBroker: safety.callsBroker
        )
    }

    func candidateReviewMaintenanceText(_ candidate: CandidateOverviewItem) -> String {
        candidate.reviewDue ? "需要复核研究档案" : "当前无需复核"
    }

    func safetyEvidenceText(_ safety: DecisionCheckSafety) -> String {
        safetyText(
            createsOrder: safety.createsOrder,
            createsTrade: safety.createsTrade,
            mutatesCash: safety.mutatesCash,
            writesFee: safety.writesFee,
            mutatesPosition: safety.mutatesPosition,
            callsBroker: safety.callsBroker
        )
    }

    func snapshotAvailabilityText(_ snapshot: DecisionContextSnapshotState) -> String {
        switch snapshot.availability {
        case .preserved:
            return "preserved：\(snapshot.envelope?.contextId ?? "missing-envelope")"
        case .contextSnapshotUnavailable:
            return "context_snapshot_unavailable：\(snapshot.limitation)"
        }
    }

    func decisionSnapshotAvailabilityText(_ state: DecisionSnapshotState?) -> String {
        guard let state else {
            return "decision_snapshot_not_captured：旧记录缺少决策事实快照，不使用当前事实倒填。"
        }
        switch state.availability {
        case .notCaptured:
            return "decision_snapshot_not_captured：\(state.limitation)"
        case .preserved:
            guard let snapshot = state.snapshot else { return "invalid：快照缺失" }
            return "preserved：\(snapshot.snapshotId)：组合=\(snapshot.portfolioContext.state.rawValue)：风险=\(snapshot.riskImpact.availability.rawValue)"
        }
    }

    func quantEvidenceStatusText(_ evidence: DecisionQuantEvidence) -> String {
        let identity = evidence.identities?.shadowPortfolioIdentity ?? "unavailable"
        return "\(evidence.status)：source=\(evidence.metadata.source)：freshness=\(evidence.metadata.freshness)：provenance=\(evidence.metadata.provenance)：authority=\(evidence.metadata.authority)：shadow=\(identity)：read-only research evidence, not ranking, recommendation, portfolio, broker, order, trade, cash, fee, or position authority."
    }

    func quantEvidenceIdentityText(_ evidence: DecisionQuantEvidence) -> String {
        let snapshotHash = evidence.identities?.frozenSnapshot.snapshotHash ?? "unavailable"
        let sourceClass = evidence.identities?.frozenSnapshot.sourceClassification ?? evidence.sampleBoundary.sourceClassification
        return "snapshotHash=\(snapshotHash)：sourceClass=\(sourceClass)：finalTest=\(evidence.sampleBoundary.finalTestPolicy)：officialFacts=false：brokerWrite=\(evidence.authority.brokerWrite)."
    }

    func reviewOutcomeLabel(_ outcome: DecisionReviewOutcome) -> String {
        switch outcome {
        case .thesisConfirmed: "确认"
        case .thesisWeakened: "削弱"
        case .thesisInvalidated: "失效"
        case .insufficientEvidence: "证据不足"
        }
    }

    func decisionActionIntentLabel(_ value: String) -> String {
        DecisionActionIntent(rawValue: value)?.label ?? "未知决定"
    }

    func humanCheckResultLabel(_ value: String) -> String {
        switch value {
        case "ready_to_consider": "可进入人工考虑"
        case "blocked": "已阻断"
        default: "需更多证据"
        }
    }

    func compactUtcDateTime(_ value: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm 'UTC'"
        return formatter.string(from: date)
    }

    func formatNumber(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 4
        formatter.minimumFractionDigits = value.rounded() == value ? 0 : 2
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    func formatOptionalNumber(_ value: Double?) -> String {
        guard let value else { return "未提供" }
        return formatNumber(value)
    }

    func stanceColor(_ stance: EvidenceStance) -> Color {
        switch stance {
        case .support: .green
        case .refute: .red
        case .neutral: .secondary
        }
    }

    func candidateQuoteColor(_ status: CandidateOverviewQuoteStatus) -> Color {
        switch status {
        case .fresh: .green
        case .stale: .orange
        case .unavailable: .secondary
        }
    }

    func candidateMembershipStateColor(_ state: CandidateMembershipState) -> Color {
        switch state {
        case .tracked: .green
        case .paused: .orange
        case .archived: .secondary
        }
    }

    func candidateDecisionIntakeColor(_ state: String) -> Color {
        stateColor(state, success: ["ready"], warning: ["archived", "missing_research", "missing_quote", "stale_quote", "review_required", "loading", "idle"], failure: ["unauthorized", "not_found", "unavailable", "malformed", "offline"])
    }

    func assistAdvisoryScopeColor(_ state: String) -> Color {
        stateColor(state, success: ["available"], warning: ["empty", "missing_research", "missing_quote", "stale_quote", "review_required", "limited", "loading", "idle"], failure: ["unauthorized", "not_found", "unavailable", "malformed", "offline"])
    }

    func assistHumanReviewWorkspaceColor(_ state: String) -> Color {
        stateColor(state, success: ["ready"], warning: ["review_limited", "blocked", "empty", "loading", "idle"], failure: ["unauthorized", "not_found", "unavailable", "malformed", "offline"])
    }

    func assistReviewFollowUpWorkflowColor(_ state: String) -> Color {
        stateColor(state, success: ["available"], warning: ["blocked"], failure: ["unauthorized", "not_found", "unavailable", "malformed"])
    }

    func assistDecisionNoteWorkflowColor(_ state: String) -> Color {
        stateColor(state, success: ["available"], warning: ["blocked", "loading", "idle"], failure: ["unauthorized", "not_found", "unavailable", "malformed", "offline", "superseded"])
    }

    func stageColor(_ status: CoreJourneyStageStatus) -> Color {
        switch status {
        case .ready, .completed: .green
        case .stale, .limited, .pending, .empty, .loading: .orange
        case .unavailable, .unauthorized, .notFound, .conflict, .malformed, .offlineError: .red
        }
    }

    private func safetyText(
        createsOrder: Bool,
        createsTrade: Bool,
        mutatesCash: Bool,
        writesFee: Bool,
        mutatesPosition: Bool,
        callsBroker: Bool
    ) -> String {
        [
            "createsOrder=\(createsOrder)",
            "createsTrade=\(createsTrade)",
            "mutatesCash=\(mutatesCash)",
            "writesFee=\(writesFee)",
            "mutatesPosition=\(mutatesPosition)",
            "callsBroker=\(callsBroker)"
        ].joined(separator: ", ")
    }

    private func stateColor(_ state: String, success: Set<String>, warning: Set<String>, failure: Set<String>) -> Color {
        if success.contains(state) { return .green }
        if warning.contains(state) { return .orange }
        if failure.contains(state) { return .red }
        return .secondary
    }
}
