import Foundation

extension ResearchClient {
    private func secondOpinionURL(_ membership: CandidateMembershipData) -> URL {
        baseURL.appending(path: "api").appending(path: "mobile").appending(path: "research")
            .appending(path: "candidate-memberships").appending(path: membership.id)
            .appending(path: "second-opinions")
    }

    public func readResearchSecondOpinionPreview(membership: CandidateMembershipData) async throws -> ResearchSecondOpinionPreview {
        var request = URLRequest(url: secondOpinionURL(membership).appending(path: "preview"),
                                 cachePolicy: .reloadIgnoringLocalCacheData)
        applyWriteAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try JSONDecoder().decode(ResearchSecondOpinionPreview.self, from: data)
    }

    public func readResearchSecondOpinionHistory(membership: CandidateMembershipData) async throws -> ResearchSecondOpinionHistory {
        var request = URLRequest(url: secondOpinionURL(membership), cachePolicy: .reloadIgnoringLocalCacheData)
        applyWriteAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try JSONDecoder().decode(ResearchSecondOpinionHistory.self, from: data)
    }

    public func runResearchSecondOpinion(membership: CandidateMembershipData,
                                         request body: ResearchSecondOpinionRequest) async throws -> ResearchSecondOpinionResult {
        var request = URLRequest(url: secondOpinionURL(membership), cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        if let failure = failedHTTPResponse(response) {
            if let result = try? JSONDecoder().decode(ResearchSecondOpinionResult.self, from: data),
               result.status == "attempted" { return result }
            throw ResearchClientError.httpStatus(failure.statusCode)
        }
        try validate(response: response)
        return try JSONDecoder().decode(ResearchSecondOpinionResult.self, from: data)
    }
}
