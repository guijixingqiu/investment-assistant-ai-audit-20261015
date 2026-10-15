public struct TodayCandidateNavigationTarget: Equatable, Hashable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let opensResearchProfileReview: Bool
    public let opensPortfolioLab: Bool
    public let opensHoldingLogicCapture: Bool

    public init(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        opensResearchProfileReview: Bool = false,
        opensPortfolioLab: Bool = false,
        opensHoldingLogicCapture: Bool = false
    ) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.opensResearchProfileReview = opensResearchProfileReview
        self.opensPortfolioLab = opensPortfolioLab
        self.opensHoldingLogicCapture = opensHoldingLogicCapture
    }
}
