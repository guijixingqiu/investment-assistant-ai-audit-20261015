import Foundation

public enum DecisionActionIntent: String, CaseIterable, Identifiable, Sendable {
    case buy
    case add
    case reduce
    case sell
    case hold
    case watch
    case abandon
    case waitForEvidence = "wait_for_evidence"

    public var id: String { rawValue }

    public static let clientVisibleCases: [DecisionActionIntent] = [.watch]
    public static let formalDecisionCases: [DecisionActionIntent] = allCases

    public var label: String {
        switch self {
        case .buy: return "买入"
        case .watch: return "观察"
        case .add: return "加仓"
        case .hold: return "持有"
        case .reduce: return "减仓"
        case .sell: return "卖出"
        case .abandon: return "放弃"
        case .waitForEvidence: return "等待证据"
        }
    }
}

public enum HumanCheckResult: String, CaseIterable, Identifiable, Sendable {
    case readyToConsider = "ready_to_consider"
    case needsMoreEvidence = "needs_more_evidence"
    case blocked

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .readyToConsider: return "通过"
        case .needsMoreEvidence: return "需证据"
        case .blocked: return "阻止"
        }
    }
}
