import Foundation

public func uniqueActiveCandidateMembership(
    for rawSymbol: String,
    in envelope: CandidateMembershipEnvelope
) -> CandidateMembershipData? {
    guard envelope.status == .available,
          let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical else { return nil }
    let matches = envelope.memberships.filter { $0.symbol == symbol && $0.state != .archived }
    guard matches.count == 1 else { return nil }
    return matches[0]
}

public func candidateResearchNavigationTarget(
    for rawSymbol: String,
    in envelope: CandidateMembershipEnvelope,
    opensPortfolioLab: Bool = false,
    opensHoldingLogicCapture: Bool = false
) -> TodayCandidateNavigationTarget? {
    guard let membership = uniqueActiveCandidateMembership(for: rawSymbol, in: envelope) else { return nil }
    return TodayCandidateNavigationTarget(
        membershipId: membership.id,
        membershipVersion: membership.version,
        symbol: membership.symbol,
        opensPortfolioLab: opensPortfolioLab,
        opensHoldingLogicCapture: opensHoldingLogicCapture
    )
}

public func candidateResearchOnboardingRestoresArchived(
    for rawSymbol: String,
    in envelope: CandidateMembershipEnvelope
) -> Bool? {
    guard envelope.status == .available || envelope.status == .empty,
          let symbol = SecuritySymbol.parseHongKongAlias(rawSymbol)?.canonical else { return nil }
    let matches = envelope.memberships.filter { $0.symbol == symbol }
    guard matches.count <= 1, matches.allSatisfy({ $0.state == .archived }) else { return nil }
    return matches.first?.state == .archived
}
