import Foundation

extension ResearchClient {
    public func fetchResearchFundamentals(
        membership: CandidateMembershipData
    ) async throws -> ResearchFundamentalsEnvelope {
        var request = URLRequest(url: researchFundamentalsURL(membershipId: membership.id), cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        try validateResearchFundamentalResponse(response)
        let envelope = try JSONDecoder().decode(ResearchFundamentalsEnvelope.self, from: data)
        try envelope.validate(expected: membership)
        return envelope
    }

    public func createResearchFundamentalAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchFundamentalValueRequest
    ) async throws -> ResearchFundamentalsEnvelope {
        var request = URLRequest(url: researchFundamentalsURL(membershipId: membership.id))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        try validateResearchFundamentalResponse(response)
        let write = try JSONDecoder().decode(ResearchWriteEnvelope<ResearchFundamentalValueData>.self, from: data)
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.symbol == membership.symbol,
              write.data.source.materialId == requestBody.sourceMaterialId else {
            throw ResearchFundamentalClientError.invalidResponse
        }
        let fresh = try await fetchResearchFundamentals(membership: membership)
        guard fresh.values.contains(write.data) else {
            throw ResearchFundamentalClientError.invalidResponse
        }
        return fresh
    }

    private func researchFundamentalsURL(membershipId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "fundamentals")
    }

    private func validateResearchFundamentalResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ResearchFundamentalClientError.invalidResponse }
        guard 200..<300 ~= http.statusCode else { throw ResearchFundamentalClientError.httpStatus(http.statusCode) }
    }
}
