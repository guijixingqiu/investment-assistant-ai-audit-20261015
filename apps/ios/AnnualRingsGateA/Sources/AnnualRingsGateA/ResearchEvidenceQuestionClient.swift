import Foundation

extension ResearchClient {
    public func askResearchEvidenceQuestion(
        membershipId: String,
        request questionRequest: ResearchEvidenceQuestionRequest
    ) async throws -> ResearchEvidenceQuestionEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "evidence-questions")
        let (data, response) = try await sendResearchEvidenceQuestion(url: url, body: questionRequest)
        let envelope = try JSONDecoder().decode(ResearchEvidenceQuestionEnvelope.self, from: data)
        if let http = failedHTTPResponse(response) {
            guard envelope.status != "available" else { throw ResearchClientError.httpStatus(http.statusCode) }
            return envelope
        }
        try validate(response: response)
        return envelope
    }

    private func sendResearchEvidenceQuestion(
        url: URL,
        body: ResearchEvidenceQuestionRequest
    ) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(body)
        return try await session.data(for: request)
    }
}
