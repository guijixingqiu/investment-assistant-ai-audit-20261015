import Foundation

enum AnnualPortfolioLabResponseDisposition: Equatable {
    case current
    case staleRequest
    case superseded
}

struct AnnualPortfolioLabRequestGate: Equatable {
    let requestId: UUID
    let membershipId: String
    let membershipVersion: Int
    let symbol: String
    let amounts: [Double]

    func disposition(
        currentRequestId: UUID,
        membershipId: String?,
        membershipVersion: Int?,
        symbol: String?,
        amounts: [Double]?
    ) -> AnnualPortfolioLabResponseDisposition {
        guard currentRequestId == requestId else { return .staleRequest }
        return membershipId == self.membershipId
            && membershipVersion == self.membershipVersion
            && symbol == self.symbol
            && amounts == self.amounts
            ? .current
            : .superseded
    }
}
