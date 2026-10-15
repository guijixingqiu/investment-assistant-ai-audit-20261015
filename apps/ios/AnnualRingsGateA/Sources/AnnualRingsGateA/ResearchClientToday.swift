import Foundation

extension ResearchClient {
    public func fetchTodayResearch(membershipId: String) async -> TodayResearchEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "today")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeTodayResearch(data, expectedMembershipId: membershipId),
               failClosed.items.isEmpty,
               todayFailureStatus(http.statusCode, envelope: failClosed) {
                return failClosed
            }
            try validate(response: response)
            let envelope = try decodeTodayResearch(data, expectedMembershipId: membershipId)
            guard envelope.status == .available else {
                throw TodayResearchValidationError.invalid(["Successful Today HTTP response must be available"])
            }
            return envelope
        } catch ResearchClientError.httpStatus(400), ResearchClientError.httpStatus(422) {
            return .unavailable(.malformed, message: "Today 请求无效，未展示旧事项。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(401), ResearchClientError.httpStatus(403) {
            return .unavailable(.unauthorized, message: "未认证：需要读取授权后查看 Today。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable(.notFound, message: "研究自选成员不存在，未展示旧事项。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(409) {
            return .unavailable(message: "Today 事实版本冲突，已停止展示。", membershipId: membershipId)
        } catch is DecodingError, TodayResearchValidationError.invalid {
            return .unavailable(.malformed, message: "Today 响应格式或语义无效，已停止展示。", membershipId: membershipId)
        } catch {
            return .unavailable(message: "Today 不可用：\(error.localizedDescription)", membershipId: membershipId)
        }
    }

    private func decodeTodayResearch(_ data: Data, expectedMembershipId: String) throws -> TodayResearchEnvelope {
        try validateTodayResearchRawShape(data)
        let envelope = try JSONDecoder().decode(TodayResearchEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedMembershipId: expectedMembershipId)
        return envelope
    }

    private func todayFailureStatus(_ statusCode: Int, envelope: TodayResearchEnvelope) -> Bool {
        switch statusCode {
        case 400, 422: envelope.status == .malformed
        case 401, 403: envelope.status == .unauthorized
        case 404: envelope.status == .notFound
        case 409: envelope.status == .conflict
        default: envelope.status == .stale || envelope.status == .unavailable
        }
    }
}
