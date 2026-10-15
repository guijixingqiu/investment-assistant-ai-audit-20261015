import Foundation

/// Keeps an applied handoff separate from its latest source verification.
/// Refreshing the same handoff blocks writes temporarily without replacing edits.
public struct ManualResearchHandoffSession: Equatable, Sendable {
    public private(set) var appliedHandoffId: UUID?
    public private(set) var verifiedHandoffId: UUID?
    public var questionDraft = ""
    public var savedEvidenceBySource: [String: String] = [:]

    public init() {}

    public mutating func beginRefresh() {
        verifiedHandoffId = nil
    }

    public mutating func invalidate() {
        verifiedHandoffId = nil
    }

    /// Returns true only when a different handoff was applied.
    @discardableResult
    public mutating func accept(handoffId: UUID, question: String) -> Bool {
        let changed = appliedHandoffId != handoffId
        if changed {
            questionDraft = question
            savedEvidenceBySource = [:]
        }
        appliedHandoffId = handoffId
        verifiedHandoffId = handoffId
        return changed
    }
}
