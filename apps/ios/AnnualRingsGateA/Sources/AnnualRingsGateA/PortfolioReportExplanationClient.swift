import Foundation

extension ResearchClient {
    public func fetchPortfolioReportExplanation(
        membershipId: String,
        membershipVersion: Int,
        membershipState: CandidateMembershipState,
        actorId: String,
        symbol: String,
        scenarioAmounts: [Double]
    ) async throws -> PortfolioReportExplanationEnvelope {
        guard portfolioReportPositiveMembershipId(membershipId), membershipVersion > 0,
              !actorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              membershipState != .archived,
              SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol,
              (1...4).contains(scenarioAmounts.count),
              scenarioAmounts.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1_000_000_000_000 }) else {
            throw PortfolioReportExplanationValidationError.invalid(["request identity is invalid"])
        }
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "portfolio-report-explanation")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = scenarioAmounts.map {
            URLQueryItem(name: "scenarioAmount", value: String($0))
        }
        guard let requestURL = components?.url else {
            throw PortfolioReportExplanationValidationError.invalid(["request URL is invalid"])
        }
        var request = URLRequest(url: requestURL)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        if let http = failedHTTPResponse(response) {
            if let envelope = try? decodePortfolioReportExplanation(
                data,
                membershipId: membershipId,
                membershipVersion: membershipVersion,
                membershipState: membershipState,
                actorId: actorId,
                symbol: symbol,
                scenarioAmounts: scenarioAmounts
            ), envelope.status != .available {
                return envelope
            }
            throw ResearchClientError.httpStatus(http.statusCode)
        }
        try validate(response: response)
        return try decodePortfolioReportExplanation(
            data,
            membershipId: membershipId,
            membershipVersion: membershipVersion,
            membershipState: membershipState,
            actorId: actorId,
            symbol: symbol,
            scenarioAmounts: scenarioAmounts
        )
    }

    private func decodePortfolioReportExplanation(
        _ data: Data,
        membershipId: String,
        membershipVersion: Int,
        membershipState: CandidateMembershipState,
        actorId: String,
        symbol: String,
        scenarioAmounts: [Double]
    ) throws -> PortfolioReportExplanationEnvelope {
        try JSONDecoder().decode(PortfolioReportExplanationEnvelope.self, from: data).validated(
            expectedMembershipId: membershipId,
            expectedMembershipVersion: membershipVersion,
            expectedMembershipState: membershipState,
            expectedActorId: actorId,
            expectedSymbol: symbol,
            expectedAmounts: scenarioAmounts
        )
    }
}

private func portfolioReportPositiveMembershipId(_ value: String) -> Bool {
    value.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil
}
