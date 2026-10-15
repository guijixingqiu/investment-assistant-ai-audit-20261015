import Foundation

public enum CoreJourneyNextActionKind: String, Equatable, Sendable {
    case fixSymbol
    case waitForLoad
    case reauthenticate
    case resolveConflict
    case retryLoad
    case refreshQuote
    case refreshResearch
    case continueWithPinganLimitation
    case submitHumanCheck
    case submitReview
    case journeyComplete
}

public enum CoreJourneyOperation: String, Equatable, Sendable {
    case load
    case decision
    case review
    case none
}

public struct CoreJourneyNextAction: Equatable, Sendable {
    public let kind: CoreJourneyNextActionKind
    public let title: String
    public let explanation: String
    public let operation: CoreJourneyOperation
    public let enabled: Bool

    public static func derive(
        state: CoreJourneyState,
        decisionEnabled: Bool,
        reviewEnabled: Bool,
        loadEnabled: Bool
    ) -> CoreJourneyNextAction {
        if let stage = first(in: state, statuses: [.malformed]) {
            return action(.fixSymbol, "修正标的输入", stage.detail, .load, loadEnabled)
        }
        if let stage = first(in: state, statuses: [.loading]) {
            return action(.waitForLoad, "等待当前读取完成", stage.detail, .none, false)
        }
        if let stage = first(in: state, statuses: [.unauthorized]) {
            return action(.reauthenticate, "补充运行时授权", stage.detail, .load, loadEnabled)
        }
        if let stage = first(in: state, statuses: [.conflict]) {
            return action(.resolveConflict, "处理冲突后刷新", stage.detail, .load, loadEnabled)
        }
        if let stage = first(in: state, statuses: [.offlineError, .unavailable, .notFound]) {
            return action(.retryLoad, "重试只读旅程读取", stage.detail, .load, loadEnabled)
        }
        if stage(.quote, in: state)?.status == .pending && !decisionEnabled {
            return action(.retryLoad, "读取只读旅程", stage(.quote, in: state)?.detail ?? "读取规范香港标的。", .load, loadEnabled)
        }
        if let quote = stage(.quote, in: state),
           quote.status == .stale || quote.status == .empty {
            return action(.refreshQuote, "刷新报价证据", quote.detail, .load, loadEnabled)
        }
        if let research = stage(.researchEvidence, in: state),
           research.status == .stale || research.status == .empty {
            return action(.refreshResearch, "刷新研究证据", research.detail, .load, loadEnabled)
        }
        if let pingan = stage(.pinganHistoricalContext, in: state),
           (pingan.status == .limited || pingan.status == .stale || pingan.status == .empty),
           stage(.humanDecisionCheck, in: state)?.status == .pending {
            return action(
                .continueWithPinganLimitation,
                "带平安限制完成人工检查",
                "\(pingan.detail) 该上下文不是实时持仓、券商对账结果，也不可用于风险影响。",
                .decision,
                decisionEnabled
            )
        }
        if let decision = stage(.humanDecisionCheck, in: state),
           decision.status == .pending {
            return action(.submitHumanCheck, "提交辅助人工检查", decision.detail, .decision, decisionEnabled)
        }
        if let review = stage(.postDecisionReview, in: state),
           review.status == .pending || review.status == .empty {
            return action(.submitReview, "提交决策后复盘", review.detail, .review, reviewEnabled)
        }
        return action(.journeyComplete, "旅程证据已完成", "五个阶段均已完成或有边界；不会创建交易或持仓变更。", .none, false)
    }

    private static func first(in state: CoreJourneyState, statuses: Set<CoreJourneyStageStatus>) -> CoreJourneyStage? {
        state.stages.first { statuses.contains($0.status) }
    }

    private static func stage(_ kind: CoreJourneyStageKind, in state: CoreJourneyState) -> CoreJourneyStage? {
        state.stages.first { $0.kind == kind }
    }

    private static func action(
        _ kind: CoreJourneyNextActionKind,
        _ title: String,
        _ explanation: String,
        _ operation: CoreJourneyOperation,
        _ enabled: Bool
    ) -> CoreJourneyNextAction {
        CoreJourneyNextAction(kind: kind, title: title, explanation: explanation, operation: operation, enabled: enabled)
    }
}
