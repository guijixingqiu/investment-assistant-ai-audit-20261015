import Foundation

extension ResearchClient {
    func researchProfileURL(market: String, code: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "profiles")
            .appending(path: market)
            .appending(path: code)
    }

    func candidateMembershipsURL(includeArchived: Bool?) -> URL {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
        guard let includeArchived else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "includeArchived", value: includeArchived ? "true" : "false")]
        return components.url!
    }

    func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        if !(200..<300).contains(httpResponse.statusCode) {
            throw ResearchClientError.httpStatus(httpResponse.statusCode)
        }
    }

    func isFailure(response: URLResponse) -> Bool {
        failedHTTPResponse(response) != nil
    }

    func failedHTTPResponse(_ response: URLResponse) -> HTTPURLResponse? {
        guard let httpResponse = response as? HTTPURLResponse,
              !(200..<300).contains(httpResponse.statusCode) else {
            return nil
        }
        return httpResponse
    }

    func isFactFreeDecisionContext(_ envelope: DecisionContextEnvelope) -> Bool {
        let quantFactFree = envelope.quantEvidence.status != "available" &&
            envelope.quantEvidence.status != "stale" &&
            envelope.quantEvidence.identities == nil &&
            envelope.quantEvidence.sampleBoundary.universe.isEmpty &&
            envelope.quantEvidence.decisionEvidence?.status != "available"
        return envelope.quote.status == "unavailable" &&
            envelope.quote.snapshotId == nil &&
            envelope.quote.fetchedAt == nil &&
            envelope.quote.source == nil &&
            envelope.quote.data == nil &&
            envelope.research.status == "unavailable" &&
            envelope.research.profile == nil &&
            envelope.research.evidence.isEmpty &&
            envelope.research.suggestions.isEmpty &&
            envelope.research.evidenceAsOf == nil &&
            envelope.suggestionSummary.status == "unavailable" &&
            envelope.suggestionSummary.linkedEvidenceIds.isEmpty &&
            quantFactFree
    }

    func pinganFailureState(_ status: PinganSnapshotStatus) -> String? {
        switch status {
        case .unauthorized:
            return "unauthorized"
        case .sourceConflict:
            return "conflict"
        case .unavailable:
            return "unavailable"
        case .available, .empty, .stale, .notApproved:
            return nil
        }
    }

    func reviewHistoryFailureState(_ envelope: DecisionReviewHistoryEnvelope) -> String? {
        switch envelope.metadata.freshness {
        case "unavailable": "unavailable"
        case "missing": "not_found"
        case "conflict": "conflict"
        default: nil
        }
    }

    func decodeCandidateOverview(_ data: Data) throws -> CandidateOverviewEnvelope {
        let envelope = try JSONDecoder().decode(CandidateOverviewEnvelope.self, from: data)
        try envelope.validateForDisplay()
        return envelope
    }

    func decodeCandidateMemberships(_ data: Data) throws -> CandidateMembershipEnvelope {
        let envelope = try JSONDecoder().decode(CandidateMembershipEnvelope.self, from: data)
        try envelope.validateForDisplay()
        return envelope
    }

    func decodeDecisionContext(_ data: Data, market: String, code: String) throws -> DecisionContextEnvelope {
        let envelope = try JSONDecoder().decode(DecisionContextEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        try validateQuantDecisionEvidenceCanonicalIdentity(data)
        return envelope
    }

    func decodeResearchProfile(_ data: Data, market: String, code: String) throws -> ResearchProfileEnvelope {
        let envelope = try JSONDecoder().decode(ResearchProfileEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        return envelope
    }

    func decodePinganSnapshot(_ data: Data, market: String, code: String) throws -> PinganSnapshotEnvelope {
        let envelope = try JSONDecoder().decode(PinganSnapshotEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        return envelope
    }

}
