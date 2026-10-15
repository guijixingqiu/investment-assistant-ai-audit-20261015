import Foundation

public struct SessionDraftFormalDecisionBinding: Equatable, Sendable {
    public let draft: LocalDecisionDraft
    public let contextId: String
    public let contextHash: String
    public let correction: String

    public init(
        draft: LocalDecisionDraft,
        contextId: String,
        contextHash: String,
        correction: String
    ) {
        self.draft = draft
        self.contextId = contextId
        self.contextHash = contextHash
        self.correction = correction.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func matches(
        draft: LocalDecisionDraft?,
        context: DecisionContextEnvelope?,
        correction: String
    ) -> Bool {
        guard let draft, let context else { return false }
        return self.draft == draft
            && draft.symbol == context.requestedSymbol
            && contextId == context.contextId
            && contextHash == context.contextHash
            && self.correction == correction.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var formalDecisionText: String {
        [
            "人工修正（提交前 session-local、未上传；本次仅随明确正式提交写入；非模型生成）：\(correction)",
            "逻辑：\(draft.thesis)",
            "时间范围：\(draft.timeHorizon)",
            "条件：\(draft.conditions)",
            "行动计划（不执行）：\(draft.actionPlan)",
            "风险：\(draft.risks)",
            "失效条件：\(draft.invalidation)",
            "这是建议/决定记录，不是订单；不自动交易。"
        ].joined(separator: "\n")
    }
}

public struct SessionDraftFormalDecisionAdoptionState: Equatable, Sendable {
    public private(set) var binding: SessionDraftFormalDecisionBinding?

    public init(binding: SessionDraftFormalDecisionBinding? = nil) {
        self.binding = binding
    }

    @discardableResult
    public mutating func adopt(
        draft: LocalDecisionDraft?,
        context: DecisionContextEnvelope?,
        correction: String
    ) -> Bool {
        let normalizedCorrection = correction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let draft, let context,
              draft.symbol == context.requestedSymbol,
              !normalizedCorrection.isEmpty else {
            binding = nil
            return false
        }
        binding = SessionDraftFormalDecisionBinding(
            draft: draft,
            contextId: context.contextId,
            contextHash: context.contextHash,
            correction: normalizedCorrection
        )
        return true
    }

    public func isCurrent(
        draft: LocalDecisionDraft?,
        context: DecisionContextEnvelope?,
        correction: String
    ) -> Bool {
        binding?.matches(draft: draft, context: context, correction: correction) == true
    }

    public mutating func invalidate() {
        binding = nil
    }
}
