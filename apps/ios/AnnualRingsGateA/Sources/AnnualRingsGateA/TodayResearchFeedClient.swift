import Foundation

public protocol TodayResearchFetching: Sendable {
    func fetchCandidateMemberships(includeArchived: Bool) async -> CandidateMembershipEnvelope
    func fetchTodayResearch(membershipId: String) async -> TodayResearchEnvelope
}

extension ResearchClient: TodayResearchFetching {}

public struct TodayResearchFeedLoadGate: Equatable, Sendable {
    public struct Ticket: Equatable, Sendable {
        fileprivate let generation: Int
        public let symbol: String
    }

    private var generation = 0
    private var activeSymbol: String?

    public init() {}

    public mutating func begin(symbol: String) -> Ticket {
        generation += 1
        activeSymbol = symbol
        return Ticket(generation: generation, symbol: symbol)
    }

    public mutating func invalidate() {
        generation += 1
        activeSymbol = nil
    }

    public func accepts(_ ticket: Ticket, currentSymbol: String?, isCancelled: Bool) -> Bool {
        !isCancelled && ticket.generation == generation
            && ticket.symbol == activeSymbol && ticket.symbol == currentSymbol
    }
}
