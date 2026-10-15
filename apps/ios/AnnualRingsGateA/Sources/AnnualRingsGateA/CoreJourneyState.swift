import Foundation

public enum CoreJourneyStageStatus: Equatable, Sendable {
    case loading
    case ready
    case limited
    case stale
    case empty
    case unavailable
    case unauthorized
    case notFound
    case conflict
    case malformed
    case offlineError
    case pending
    case completed

    public var label: String {
        switch self {
        case .loading: return "读取中"
        case .ready: return "可用"
        case .limited: return "有限"
        case .stale: return "历史"
        case .empty: return "为空"
        case .unavailable: return "不可用"
        case .unauthorized: return "未授权"
        case .notFound: return "不存在"
        case .conflict: return "冲突"
        case .malformed: return "响应无效"
        case .offlineError: return "错误"
        case .pending: return "待处理"
        case .completed: return "已完成"
        }
    }
}

public enum CoreJourneyStageKind: String, CaseIterable, Sendable {
    case quote
    case researchEvidence
    case pinganHistoricalContext
    case humanDecisionCheck
    case postDecisionReview

    var title: String {
        switch self {
        case .quote: return "报价"
        case .researchEvidence: return "研究证据"
        case .pinganHistoricalContext: return "平安历史持仓上下文"
        case .humanDecisionCheck: return "人工决策检查"
        case .postDecisionReview: return "决策后复盘"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .quote: return "coreJourneyStageQuote"
        case .researchEvidence: return "coreJourneyStageResearchEvidence"
        case .pinganHistoricalContext: return "coreJourneyStagePinganContext"
        case .humanDecisionCheck: return "coreJourneyStageHumanDecisionCheck"
        case .postDecisionReview: return "coreJourneyStagePostDecisionReview"
        }
    }
}

public struct CoreJourneyStage: Equatable, Identifiable, Sendable {
    public let kind: CoreJourneyStageKind
    public let order: Int
    public let title: String
    public let status: CoreJourneyStageStatus
    public let detail: String
    public let accessibilityIdentifier: String

    public var id: String { kind.rawValue }
}

public struct CoreJourneyState: Equatable, Sendable {
    public static let safetyStatement = "仅提供投资辅助与人工记录；不会创建订单、交易、成交、现金、费用、持仓变更或券商调用。"

    public let symbol: String
    public let stages: [CoreJourneyStage]
    public let safetyStatement: String

    public static func derive(
        symbol: String,
        isLoading: Bool,
        malformedInputMessage: String?,
        researchEnvelope: ResearchProfileEnvelope,
        decisionContext: DecisionContextEnvelope?,
        decisionContextMessage: String?,
        pinganSnapshot: PinganSnapshotEnvelope?,
        pinganSnapshotMessage: String?,
        submittedDecision: DecisionCheckData?,
        decisionReviewHistory: DecisionReviewHistoryEnvelope?,
        decisionReviewMessage: String?
    ) -> CoreJourneyState {
        let specs: [(CoreJourneyStageKind, CoreJourneyStageStatus, String)] = [
            stageSpec(.quote, quoteStatus(
                isLoading: isLoading,
                malformedInputMessage: malformedInputMessage,
                decisionContext: decisionContext,
                decisionContextMessage: decisionContextMessage
            )),
            stageSpec(.researchEvidence, researchStatus(
                isLoading: isLoading,
                malformedInputMessage: malformedInputMessage,
                envelope: researchEnvelope
            )),
            stageSpec(.pinganHistoricalContext, pinganStatus(
                isLoading: isLoading,
                malformedInputMessage: malformedInputMessage,
                snapshot: pinganSnapshot,
                message: pinganSnapshotMessage
            )),
            stageSpec(.humanDecisionCheck, humanCheckStatus(
                symbol: symbol,
                isLoading: isLoading,
                malformedInputMessage: malformedInputMessage,
                decisionContext: decisionContext,
                decisionContextMessage: decisionContextMessage,
                submittedDecision: submittedDecision,
                decisionReviewHistory: decisionReviewHistory
            )),
            stageSpec(.postDecisionReview, reviewStatus(
                symbol: symbol,
                isLoading: isLoading,
                malformedInputMessage: malformedInputMessage,
                decisionContext: decisionContext,
                submittedDecision: submittedDecision,
                history: decisionReviewHistory,
                message: decisionReviewMessage
            ))
        ]

        return CoreJourneyState(
            symbol: symbol,
            stages: specs.enumerated().map { index, spec in
                CoreJourneyStage(
                    kind: spec.0,
                    order: index + 1,
                    title: spec.0.title,
                    status: spec.1,
                    detail: spec.2,
                    accessibilityIdentifier: spec.0.accessibilityIdentifier
                )
            },
            safetyStatement: Self.safetyStatement
        )
    }

    private static func stageSpec(
        _ kind: CoreJourneyStageKind,
        _ statusAndDetail: (CoreJourneyStageStatus, String)
    ) -> (CoreJourneyStageKind, CoreJourneyStageStatus, String) {
        (kind, statusAndDetail.0, statusAndDetail.1)
    }

    private static func quoteStatus(
        isLoading: Bool,
        malformedInputMessage: String?,
        decisionContext: DecisionContextEnvelope?,
        decisionContextMessage: String?
    ) -> (CoreJourneyStageStatus, String) {
        if let malformedInputMessage {
            return (.malformed, malformedInputMessage)
        }
        if let quote = decisionContext?.quote {
            switch quote.status {
            case "fresh":
                return (.ready, quote.message)
            case "stale":
                return (.stale, quote.staleReason ?? quote.message)
            case "empty":
                return (.empty, quote.message)
            case "permission_denied":
                return (.unauthorized, quote.message)
            default:
                return (.unavailable, quote.message)
            }
        }
        return messageStatus(message: decisionContextMessage, isLoading: isLoading)
    }

    private static func researchStatus(
        isLoading: Bool,
        malformedInputMessage: String?,
        envelope: ResearchProfileEnvelope
    ) -> (CoreJourneyStageStatus, String) {
        if let malformedInputMessage {
            return (.malformed, malformedInputMessage)
        }
        guard let data = envelope.data else {
            return messageStatus(message: envelope.message, isLoading: isLoading)
        }
        if let metadata = envelope.metadata, metadata.freshness == "stale" || metadata.stale {
            return (.stale, metadata.message)
        }
        if let metadata = envelope.metadata, metadata.freshness == "missing" || metadata.missing {
            return (.empty, metadata.message)
        }
        if data.evidence.isEmpty {
            return (.empty, "研究资料已读取，但当前没有证据条目。")
        }
        return (.ready, "已读取 \(data.evidence.count) 条研究证据和 \(data.suggestions.count) 条辅助建议。")
    }

    private static func pinganStatus(
        isLoading: Bool,
        malformedInputMessage: String?,
        snapshot: PinganSnapshotEnvelope?,
        message: String?
    ) -> (CoreJourneyStageStatus, String) {
        if let malformedInputMessage {
            return (.malformed, malformedInputMessage)
        }
        guard let snapshot else {
            return messageStatus(message: message, isLoading: isLoading)
        }
        switch snapshot.status {
        case .available:
            return (.limited, "仅可带警示展示，不可用于风险影响或实时持仓。")
        case .stale:
            return (.stale, snapshot.warning ?? snapshot.stateMessage)
        case .empty:
            return (.empty, snapshot.stateMessage)
        case .unavailable:
            return (.unavailable, snapshot.stateMessage)
        case .unauthorized:
            return (.unauthorized, snapshot.stateMessage)
        case .sourceConflict:
            return (.conflict, snapshot.stateMessage)
        case .notApproved:
            return (.unavailable, snapshot.stateMessage)
        }
    }

    private static func humanCheckStatus(
        symbol: String,
        isLoading: Bool,
        malformedInputMessage: String?,
        decisionContext: DecisionContextEnvelope?,
        decisionContextMessage: String?,
        submittedDecision: DecisionCheckData?,
        decisionReviewHistory: DecisionReviewHistoryEnvelope?
    ) -> (CoreJourneyStageStatus, String) {
        if let malformedInputMessage {
            return (.malformed, malformedInputMessage)
        }
        guard let decisionContext else {
            return messageStatus(message: decisionContextMessage, isLoading: isLoading)
        }
        if let submittedDecision,
           submittedDecisionMatchesCurrentContext(
            submittedDecision,
            symbol: symbol,
            decisionContext: decisionContext
           ) {
            return (.completed, "已记录人工检查 \(submittedDecision.id)，不产生交易副作用。")
        }
        if let historyDecision = currentHistoryDecision(
            symbol: symbol,
            decisionContext: decisionContext,
            history: decisionReviewHistory
        ) {
            return (.completed, "已从精确历史读回人工检查 \(historyDecision.id)，不产生交易副作用。")
        }
        return (.pending, "决策上下文已就绪，等待人工检查。")
    }

    public static func submittedDecisionMatchesCurrentContext(
        _ submittedDecision: DecisionCheckData,
        symbol: String,
        decisionContext: DecisionContextEnvelope
    ) -> Bool {
        submittedDecision.symbol == symbol &&
            submittedDecision.symbol == decisionContext.requestedSymbol &&
            submittedDecision.decisionContextSchemaVersion == decisionContext.schemaVersion &&
            submittedDecision.contextId == decisionContext.contextId &&
            submittedDecision.contextHash == decisionContext.contextHash
    }

    public static func currentHistoryDecision(
        symbol: String,
        decisionContext: DecisionContextEnvelope?,
        history: DecisionReviewHistoryEnvelope?
    ) -> RecordedDecisionCheckReviewState? {
        guard let decisionContext, let history,
              history.requestedSymbol == symbol,
              history.requestedSymbol == decisionContext.requestedSymbol,
              history.metadata.freshness == "fresh",
              history.metadata.provenance == "real",
              history.metadata.authority == "decision_context",
              history.metadata.stale == false,
              history.metadata.missing == false,
              history.metadata.conflict == false,
              history.metadata.fixture == false else { return nil }
        return history.checks.first {
            $0.symbol == symbol &&
                $0.decisionContextSchemaVersion == decisionContext.schemaVersion &&
                $0.contextId == decisionContext.contextId &&
                $0.contextHash == decisionContext.contextHash
        }
    }

    private static func reviewStatus(
        symbol: String,
        isLoading: Bool,
        malformedInputMessage: String?,
        decisionContext: DecisionContextEnvelope?,
        submittedDecision: DecisionCheckData?,
        history: DecisionReviewHistoryEnvelope?,
        message: String?
    ) -> (CoreJourneyStageStatus, String) {
        if let malformedInputMessage {
            return (.malformed, malformedInputMessage)
        }
        guard let history else {
            return messageStatus(message: message, isLoading: isLoading)
        }
        if history.metadata.freshness == "unavailable" ||
            history.metadata.provenance == "unavailable" ||
            history.metadata.authority == "unavailable" {
            return (.unavailable, history.message)
        }
        if history.checks.flatMap(\.reviews).isEmpty {
            return (.empty, "已读取复盘历史，但尚无复盘记录。")
        }
        let submittedHistoryDecision = submittedDecision.flatMap { submitted in
            history.checks.first {
                $0.id == submitted.id && $0.symbol == submitted.symbol &&
                    $0.decisionContextSchemaVersion == submitted.decisionContextSchemaVersion &&
                    $0.contextId == submitted.contextId && $0.contextHash == submitted.contextHash
            }
        }
        guard let currentDecision = submittedHistoryDecision ?? currentHistoryDecision(
            symbol: symbol,
            decisionContext: decisionContext,
            history: history
        ) else {
            return history.checks.isEmpty
                ? (.empty, "已读取复盘历史，但尚无复盘记录。")
                : (.pending, "仅有其他决策上下文的历史复盘；当前上下文仍待复盘。")
        }
        if currentDecision.reviews.isEmpty {
            return (.empty, "当前人工检查已读取，但尚无复盘记录。")
        }
        return (.completed, "已读取当前人工检查和精确复盘记录。")
    }

    private static func messageStatus(message: String?, isLoading: Bool) -> (CoreJourneyStageStatus, String) {
        let value = message ?? ""
        if value.contains("正在") || isLoading {
            return (.loading, value.isEmpty ? "正在读取当前状态。" : value)
        }
        if value.contains("未认证") || value.contains("未授权") {
            return (.unauthorized, value)
        }
        let lowercasedValue = value.lowercased()
        if value.contains("不存在") || lowercasedValue.contains("not found") || lowercasedValue.contains("not_found") {
            return (.notFound, value)
        }
        if value.contains("冲突") {
            return (.conflict, value)
        }
        if value.contains("语义无效") || value.contains("格式无效") || value.contains("请求无效") || value.contains("响应") && value.contains("无效") {
            return (.malformed, value)
        }
        if value.contains("离线") || value.contains("不可用") || value.contains("失败") || lowercasedValue.contains("offline") || lowercasedValue.contains("error") {
            return (.offlineError, value)
        }
        return (.unavailable, value.isEmpty ? "当前状态不可用。" : value)
    }
}
