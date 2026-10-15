import Foundation

public protocol ResearchProfileFetching: Sendable {
    func fetchCandidateOverview() async -> CandidateOverviewEnvelope
    func fetchCandidateMemberships(includeArchived: Bool) async -> CandidateMembershipEnvelope
    func fetchCandidateDecisionIntake(membershipId: String) async -> CandidateDecisionIntakeEnvelope
    func fetchAnnualDecisionBrief(membershipId: String) async -> AnnualDecisionBriefEnvelope
    func fetchAssistAdvisoryScope(membershipId: String) async -> AssistAdvisoryScopeEnvelope
    func fetchAssistHumanReviewWorkspace(membershipId: String) async -> AssistHumanReviewWorkspaceEnvelope
    func fetchAssistReviewFollowUpWorkflow(membershipId: String) async -> AssistReviewFollowUpWorkflowEnvelope
    func fetchAssistDecisionNoteWorkflow(membershipId: String) async -> AssistDecisionNoteWorkflowEnvelope
    func askResearchEvidenceQuestion(membershipId: String, request: ResearchEvidenceQuestionRequest) async throws -> ResearchEvidenceQuestionEnvelope
    func fetchProfile(market: String, code: String) async throws -> ResearchProfileEnvelope
    func fetchDecisionContext(market: String, code: String) async throws -> DecisionContextEnvelope
    func fetchPinganSnapshot(market: String, code: String) async throws -> PinganSnapshotEnvelope
    func fetchDecisionReviewHistory(market: String, code: String) async throws -> DecisionReviewHistoryEnvelope
    func decideSuggestion(id: String, action: SuggestionStatus, note: String?) async throws -> SuggestionDecisionResponse
    func createCandidateMembership(request: CreateCandidateMembershipRequest) async throws -> CandidateMembershipWriteEnvelope
    func updateCandidateMembershipState(id: String, request: UpdateCandidateMembershipStateRequest) async throws -> CandidateMembershipWriteEnvelope
    func updateProfile(market: String, code: String, request: UpdateResearchProfileRequest) async throws -> ResearchWriteEnvelope<ResearchProfileData>
    func createEvidence(market: String, code: String, request: CreateEvidenceRequest) async throws -> ResearchWriteEnvelope<EvidenceItemData>
    func createDecisionCheck(market: String, code: String, request: CreateDecisionCheckRequest) async throws -> ResearchWriteEnvelope<DecisionCheckData>
    func createPostDecisionReview(market: String, code: String, checkId: String, request: CreatePostDecisionReviewRequest) async throws -> ResearchWriteEnvelope<PostDecisionReviewData>
    func deleteDecisionCheckAndReadBack(market: String, code: String, check: RecordedDecisionCheckReviewState, idempotencyKey: String) async throws -> (deletion: DecisionReviewDeletionData, history: DecisionReviewHistoryEnvelope)
    func deletePostDecisionReviewAndReadBack(market: String, code: String, checkId: String, review: PostDecisionReviewData, idempotencyKey: String) async throws -> (deletion: DecisionReviewDeletionData, history: DecisionReviewHistoryEnvelope)
}

public func candidateMembershipIdentityMatches(_ expected: CandidateMembershipData, membershipIds: [String?], symbol: String?, version: Int? = nil) -> Bool {
    let presentIds = membershipIds.compactMap { $0 }
    return !presentIds.isEmpty && presentIds.allSatisfy { $0 == expected.id } && symbol == expected.symbol && (version == nil || version == expected.version)
}

func researchHTTPFailureState(_ statusCode: Int) -> String {
    switch statusCode {
    case 400, 422:
        return "malformed"
    case 401, 403:
        return "unauthorized"
    case 404:
        return "not_found"
    case 409:
        return "conflict"
    default:
        return "unavailable"
    }
}

public final class ResearchClient: ResearchProfileFetching, @unchecked Sendable {
    let baseURL: URL
    let session: URLSession
    var authToken: String?
    var writeAuthToken: String?
    var authHeaderName: String
    var writeAuthHeaderName: String
    let authorizationLock = NSLock()

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        authToken: String? = nil,
        authHeaderName: String = "x-internal-token",
        writeAuthToken: String? = nil,
        writeAuthHeaderName: String? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
        self.writeAuthToken = writeAuthToken
        self.authHeaderName = authHeaderName
        self.writeAuthHeaderName = writeAuthHeaderName ?? authHeaderName
    }

    public func fetchCandidateOverview() async -> CandidateOverviewEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidates")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeCandidateOverview(data),
               failClosed.status == .unavailable,
               failClosed.candidates.isEmpty,
               researchHTTPFailureState(http.statusCode) == "unavailable" {
                return failClosed
            }
            try validate(response: response)
            return try decodeCandidateOverview(data)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要授权后查看候选标的。")
        } catch {
            return .unavailable("候选标的概览不可用：\(error.localizedDescription)")
        }
    }

    public func fetchCandidateMemberships(includeArchived: Bool) async -> CandidateMembershipEnvelope {
        let url = candidateMembershipsURL(includeArchived: includeArchived)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeCandidateMemberships(data),
               failClosed.status == .unavailable,
               failClosed.memberships.isEmpty,
               researchHTTPFailureState(http.statusCode) == "unavailable" {
                return failClosed
            }
            try validate(response: response)
            return try decodeCandidateMemberships(data)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要读取授权后查看研究自选。", includeArchived: includeArchived)
        } catch ResearchClientError.httpStatus(503) {
            return .unavailable("研究自选仓库不可用，未展示旧数据或部分数据。", includeArchived: includeArchived)
        } catch is DecodingError {
            return .unavailable("研究自选响应格式无效，已阻止展示。", includeArchived: includeArchived)
        } catch CandidateMembershipValidationError.invalid {
            return .unavailable("研究自选响应语义无效，已阻止展示。", includeArchived: includeArchived)
        } catch {
            return .unavailable("研究自选不可用：\(error.localizedDescription)", includeArchived: includeArchived)
        }
    }

    public func fetchCandidateDecisionIntake(membershipId: String) async -> CandidateDecisionIntakeEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "decision-intake")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeCandidateDecisionIntake(data, expectedMembershipId: membershipId),
               failClosed.status != .available,
               failClosed.membership == nil,
               failClosed.decisionContext == nil {
                return .unavailable(
                    failClosed.message,
                    membershipId: membershipId,
                    clientFailureState: researchHTTPFailureState(http.statusCode)
                )
            }
            try validate(response: response)
            return try decodeCandidateDecisionIntake(data, expectedMembershipId: membershipId)
        } catch ResearchClientError.httpStatus(401), ResearchClientError.httpStatus(403) {
            return .unavailable("未认证：需要读取授权后查看决策准备。", membershipId: membershipId, clientFailureState: "unauthorized")
        } catch ResearchClientError.httpStatus(400), ResearchClientError.httpStatus(422) {
            return .unavailable("决策准备请求无效，已阻止展示旧数据或部分数据。", membershipId: membershipId, clientFailureState: "malformed")
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable("研究自选成员不存在，未展示旧数据或部分数据。", membershipId: membershipId, clientFailureState: "not_found")
        } catch ResearchClientError.httpStatus(409) {
            return .unavailable("决策准备事实冲突，已阻止展示旧数据或部分数据。", membershipId: membershipId, clientFailureState: "conflict")
        } catch ResearchClientError.httpStatus(_) {
            return .unavailable("决策准备 HTTP 请求失败，已阻止展示旧数据或部分数据。", membershipId: membershipId, clientFailureState: "unavailable")
        } catch is DecodingError {
            return .unavailable("决策准备响应格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch CandidateDecisionIntakeValidationError.invalid {
            return .unavailable("决策准备响应语义无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch {
            return .unavailable("决策准备不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "offline")
        }
    }

    public func fetchAssistAdvisoryScope(membershipId: String) async -> AssistAdvisoryScopeEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "advisory-scope")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeAssistAdvisoryScope(data, expectedMembershipId: membershipId),
               failClosed.status.rawValue == researchHTTPFailureState(http.statusCode),
               failClosed.facts.isEmpty {
                return failClosed
            }
            try validate(response: response)
            return try decodeAssistAdvisoryScope(data, expectedMembershipId: membershipId)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要读取授权后查看 ASSIST 范围。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable("研究自选成员不存在，未展示旧数据或部分数据。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(503) {
            return .unavailable("ASSIST 范围仓库不可用，未展示旧数据或部分数据。", membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("ASSIST 范围响应格式无效，已阻止展示。", membershipId: membershipId)
        } catch AssistAdvisoryScopeValidationError.invalid {
            return .unavailable("ASSIST 范围响应语义无效，已阻止展示。", membershipId: membershipId)
        } catch {
            return .unavailable("ASSIST 范围不可用：\(error.localizedDescription)", membershipId: membershipId)
        }
    }

    public func fetchAssistHumanReviewWorkspace(membershipId: String) async -> AssistHumanReviewWorkspaceEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "human-review-workspace")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeAssistHumanReviewWorkspace(data, expectedMembershipId: membershipId),
               failClosed.status.rawValue == researchHTTPFailureState(http.statusCode),
               failClosed.evidenceGroups.isEmpty,
               failClosed.failClosed.active {
                return failClosed
            }
            try validate(response: response)
            return try decodeAssistHumanReviewWorkspace(data, expectedMembershipId: membershipId)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要读取授权后查看本地人工复核工作台。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable("研究自选成员不存在，未展示旧工作台事实或部分事实。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(503) {
            return .unavailable("本地人工复核工作台仓库不可用，未展示旧事实或部分事实。", membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("本地人工复核工作台响应格式无效，已阻止展示。", membershipId: membershipId)
        } catch AssistHumanReviewWorkspaceValidationError.invalid {
            return .unavailable("本地人工复核工作台响应语义无效，已阻止展示。", membershipId: membershipId)
        } catch {
            return .unavailable("本地人工复核工作台不可用：\(error.localizedDescription)", membershipId: membershipId)
        }
    }

    public func fetchAssistReviewFollowUpWorkflow(membershipId: String) async -> AssistReviewFollowUpWorkflowEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "human-review-workspace")
            .appending(path: "follow-up-workflow")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeAssistReviewFollowUpWorkflow(data, expectedMembershipId: membershipId),
               failClosed.status.rawValue == researchHTTPFailureState(http.statusCode),
               failClosed.manualNoteDraft == nil,
               failClosed.laterReviewIntent == nil,
               failClosed.intents.isEmpty,
               failClosed.failClosed.active {
                return failClosed
            }
            try validate(response: response)
            return try decodeAssistReviewFollowUpWorkflow(data, expectedMembershipId: membershipId)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要读取授权后查看本地复核后续 workflow。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable("研究自选成员不存在，未展示旧 workflow 事实或本地草稿。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(503) {
            return .unavailable("本地复核后续 workflow 仓库不可用，未展示旧事实或本地草稿。", membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("本地复核后续 workflow 响应格式无效，已阻止展示。", membershipId: membershipId)
        } catch AssistReviewFollowUpWorkflowValidationError.invalid {
            return .unavailable("本地复核后续 workflow 响应语义无效，已阻止展示。", membershipId: membershipId)
        } catch {
            return .unavailable("本地复核后续 workflow 不可用：\(error.localizedDescription)", membershipId: membershipId)
        }
    }

    public func fetchAssistDecisionNoteWorkflow(membershipId: String) async -> AssistDecisionNoteWorkflowEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membershipId)
            .appending(path: "human-review-workspace")
            .appending(path: "follow-up-workflow")
            .appending(path: "decision-note-workflow")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            if let http = failedHTTPResponse(response),
               let failClosed = try? decodeAssistDecisionNoteWorkflow(data, expectedMembershipId: membershipId),
               failClosed.status.rawValue == researchHTTPFailureState(http.statusCode),
               failClosed.decisionNoteDraft == nil,
               failClosed.factReferences.isEmpty,
               failClosed.laterReviewEntry == nil,
               failClosed.failClosed.active {
                return failClosed
            }
            try validate(response: response)
            return try decodeAssistDecisionNoteWorkflow(data, expectedMembershipId: membershipId)
        } catch ResearchClientError.httpStatus(401) {
            return .unavailable("未认证：需要读取授权后查看本地 decision note workflow。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(404) {
            return .unavailable("研究自选成员不存在，未展示旧 decision note 事实或本地草稿。", membershipId: membershipId)
        } catch ResearchClientError.httpStatus(503) {
            return .unavailable("本地 decision note workflow 仓库不可用，未展示旧事实或本地草稿。", membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("本地 decision note workflow 响应格式无效，已阻止展示。", membershipId: membershipId)
        } catch AssistDecisionNoteWorkflowValidationError.invalid {
            return .unavailable("本地 decision note workflow 响应语义无效，已阻止展示。", membershipId: membershipId)
        } catch {
            return .unavailable("本地 decision note workflow 不可用：\(error.localizedDescription)", membershipId: membershipId)
        }
    }

    public func fetchProfile(market: String, code: String) async throws -> ResearchProfileEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "profiles")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        if let http = failedHTTPResponse(response),
           researchHTTPFailureState(http.statusCode) == "unavailable",
           let failClosed = try? decodeResearchProfile(data, market: market, code: code),
           failClosed.data == nil,
           failClosed.metadata?.freshness == "unavailable" {
            return failClosed
        }
        try validate(response: response)
        return try decodeResearchProfile(data, market: market, code: code)
    }

    public func fetchDecisionContext(market: String, code: String) async throws -> DecisionContextEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "decision-context")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        if let http = failedHTTPResponse(response),
           researchHTTPFailureState(http.statusCode) == "unavailable",
           let failClosed = try? decodeDecisionContext(data, market: market, code: code),
           isFactFreeDecisionContext(failClosed) {
            return failClosed
        }
        try validate(response: response)
        return try decodeDecisionContext(data, market: market, code: code)
    }

    public func fetchPinganSnapshot(market: String, code: String) async throws -> PinganSnapshotEnvelope {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "portfolio")
            .appending(path: "pingan-snapshot")
            .appending(path: market)
            .appending(path: code)
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        if let http = failedHTTPResponse(response),
           let failClosed = try? decodePinganSnapshot(data, market: market, code: code),
           pinganFailureState(failClosed.status) == researchHTTPFailureState(http.statusCode),
           failClosed.positions.isEmpty,
           failClosed.positionCount == 0,
           !failClosed.hasDisplayablePositions {
            return failClosed
        }
        try validate(response: response)
        return try decodePinganSnapshot(data, market: market, code: code)
    }

    public func fetchDecisionReviewHistory(market: String, code: String) async throws -> DecisionReviewHistoryEnvelope {
        let url = researchProfileURL(market: market, code: code)
            .appending(path: "decision-reviews")
        var request = URLRequest(url: url)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        if let http = failedHTTPResponse(response),
           let failClosed = try? await decodeDecisionReviewHistory(data, market: market, code: code),
           reviewHistoryFailureState(failClosed) == researchHTTPFailureState(http.statusCode),
           failClosed.checks.isEmpty,
           failClosed.learningSummary == nil {
            return failClosed
        }
        try validate(response: response)
        return try await decodeDecisionReviewHistory(data, market: market, code: code)
    }

    public func decideSuggestion(id: String, action: SuggestionStatus, note: String?) async throws -> SuggestionDecisionResponse {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "internal")
            .appending(path: "research")
            .appending(path: "suggestions")
            .appending(path: id)
            .appending(path: "decision")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(SuggestionDecisionRequest(action: action.rawValue, note: note))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try JSONDecoder().decode(SuggestionDecisionResponse.self, from: data)
    }

    public func createCandidateMembership(request: CreateCandidateMembershipRequest) async throws -> CandidateMembershipWriteEnvelope {
        let response = try await sendJSON(
            "POST",
            url: candidateMembershipsURL(includeArchived: nil),
            body: request,
            responseType: CandidateMembershipWriteEnvelope.self
        )
        try response.validateForDisplay()
        return response
    }

    public func updateCandidateMembershipState(id: String, request: UpdateCandidateMembershipStateRequest) async throws -> CandidateMembershipWriteEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: id)
            .appending(path: "state")
        let response = try await sendJSON(
            "PATCH",
            url: url,
            body: request,
            responseType: CandidateMembershipWriteEnvelope.self
        )
        try response.validateForDisplay()
        return response
    }

    public func updateProfile(market: String, code: String, request: UpdateResearchProfileRequest) async throws -> ResearchWriteEnvelope<ResearchProfileData> {
        let url = researchProfileURL(market: market, code: code)
        let response = try await sendJSON("PUT", url: url, body: request, responseType: ResearchWriteEnvelope<ResearchProfileData>.self)
        try response.validateForDisplay(market: market, code: code)
        return response
    }

    public func createEvidence(market: String, code: String, request: CreateEvidenceRequest) async throws -> ResearchWriteEnvelope<EvidenceItemData> {
        let url = researchProfileURL(market: market, code: code)
            .appending(path: "evidence")
        let response = try await sendJSON("POST", url: url, body: request, responseType: ResearchWriteEnvelope<EvidenceItemData>.self)
        try response.validateForDisplay()
        return response
    }

    public func createDecisionCheck(market: String, code: String, request: CreateDecisionCheckRequest) async throws -> ResearchWriteEnvelope<DecisionCheckData> {
        let url = researchProfileURL(market: market, code: code)
            .appending(path: "decision-checks")
        let (response, rawData) = try await sendJSONWithRawData("POST", url: url, body: request, responseType: ResearchWriteEnvelope<DecisionCheckData>.self)
        try response.validateForDisplay(market: market, code: code, request: request)
        do {
            try validateDecisionCheckSnapshotIdentities(rawData)
        } catch DecisionSnapshotValidationError.invalid(let errors) {
            throw DecisionWriteValidationError.invalid(errors)
        }
        if request.conditionalDecision != nil {
            do { try validateAnnualConditionalDecisionWriteRaw(rawData, request: request) }
            catch AnnualConditionalDecisionValidationError.invalid(let errors) {
                throw DecisionWriteValidationError.invalid(errors)
            }
        }
        return response
    }

    public func createPostDecisionReview(market: String, code: String, checkId: String, request: CreatePostDecisionReviewRequest) async throws -> ResearchWriteEnvelope<PostDecisionReviewData> {
        let url = researchProfileURL(market: market, code: code)
            .appending(path: "decision-checks")
            .appending(path: checkId)
            .appending(path: "reviews")
        let (response, rawData) = try await sendJSONWithRawData(
            "POST",
            url: url,
            body: request,
            responseType: ResearchWriteEnvelope<PostDecisionReviewData>.self
        )
        try response.validateForDisplay(
            market: market,
            code: code,
            checkId: checkId,
            request: request
        )
        try response.validatePortfolioReviewBinding(request.portfolioReviewBinding)
        do {
            try validatePostDecisionReviewWritePortfolioIdentities(rawData)
        } catch DecisionSnapshotValidationError.invalid(let errors) {
            throw DecisionWriteValidationError.invalid(errors)
        }
        return response
    }

    private func decodeDecisionReviewHistory(_ data: Data, market: String, code: String) async throws -> DecisionReviewHistoryEnvelope {
        try Task.checkCancellation()
        let envelope: DecisionReviewHistoryEnvelope = try await withCheckedThrowingContinuation { continuation in
            // A decision history contains the preserved context for each check.
            // Decode and validate from the raw bytes on this operation's bounded
            // larger stack; moving an already-decoded DTO would be too late.
            let worker = Thread {
                do {
                    continuation.resume(returning: try Self.decodeDecisionReviewHistoryRaw(data, market: market, code: code))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            worker.name = "decision-review-history-validation"
            worker.stackSize = 8 * 1_024 * 1_024
            worker.start()
        }
        try Task.checkCancellation()
        return envelope
    }

    private static func decodeDecisionReviewHistoryRaw(_ data: Data, market: String, code: String) throws -> DecisionReviewHistoryEnvelope {
        let envelope = try JSONDecoder().decode(DecisionReviewHistoryEnvelope.self, from: data)
        try envelope.validateForDisplay(market: market, code: code)
        do {
            try validateDecisionReviewSnapshotIdentities(data)
        } catch DecisionSnapshotValidationError.invalid(let errors) {
            throw DecisionReviewValidationError.invalid(errors)
        }
        return envelope
    }

    private func decodeCandidateDecisionIntake(_ data: Data, expectedMembershipId: String) throws -> CandidateDecisionIntakeEnvelope {
        let envelope = try JSONDecoder().decode(CandidateDecisionIntakeEnvelope.self, from: data)
        try envelope.validateForDisplay()
        try validateQuantDecisionEvidenceCanonicalIdentity(data, nestedContextKey: "decisionContext")
        guard responseMembershipIdentifiersMatch([envelope.membershipId], expected: expectedMembershipId) else {
            throw CandidateDecisionIntakeValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func decodeAssistAdvisoryScope(_ data: Data, expectedMembershipId: String) throws -> AssistAdvisoryScopeEnvelope {
        let envelope = try JSONDecoder().decode(AssistAdvisoryScopeEnvelope.self, from: data)
        try envelope.validateForDisplay()
        guard responseMembershipIdentifiersMatch([envelope.candidateMembershipId, envelope.target.candidateMembershipId], expected: expectedMembershipId) else {
            throw AssistAdvisoryScopeValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func decodeAssistHumanReviewWorkspace(_ data: Data, expectedMembershipId: String) throws -> AssistHumanReviewWorkspaceEnvelope {
        let envelope = try JSONDecoder().decode(AssistHumanReviewWorkspaceEnvelope.self, from: data)
        try envelope.validateForDisplay()
        guard responseMembershipIdentifiersMatch([envelope.target.candidateMembershipId, envelope.sourceEnvelopeRef.candidateMembershipId], expected: expectedMembershipId) else {
            throw AssistHumanReviewWorkspaceValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func decodeAssistReviewFollowUpWorkflow(_ data: Data, expectedMembershipId: String) throws -> AssistReviewFollowUpWorkflowEnvelope {
        let envelope = try JSONDecoder().decode(AssistReviewFollowUpWorkflowEnvelope.self, from: data)
        try envelope.validateForDisplay()
        guard responseMembershipIdentifiersMatch([envelope.target.candidateMembershipId], expected: expectedMembershipId) else {
            throw AssistReviewFollowUpWorkflowValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func decodeAssistDecisionNoteWorkflow(_ data: Data, expectedMembershipId: String) throws -> AssistDecisionNoteWorkflowEnvelope {
        let envelope = try JSONDecoder().decode(AssistDecisionNoteWorkflowEnvelope.self, from: data)
        try envelope.validateForDisplay()
        guard responseMembershipIdentifiersMatch([envelope.target.candidateMembershipId], expected: expectedMembershipId) else {
            throw AssistDecisionNoteWorkflowValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func responseMembershipIdentifiersMatch(_ identifiers: [String?], expected: String) -> Bool {
        let present = identifiers.compactMap { $0 }
        return !present.isEmpty && present.allSatisfy { $0 == expected }
    }

    private func sendJSON<TBody: Encodable, TResponse: Decodable>(
        _ method: String,
        url: URL,
        body: TBody,
        responseType: TResponse.Type
    ) async throws -> TResponse {
        try await sendJSONWithRawData(method, url: url, body: body, responseType: responseType).response
    }

    private func sendJSONWithRawData<TBody: Encodable, TResponse: Decodable>(
        _ method: String,
        url: URL,
        body: TBody,
        responseType: TResponse.Type
    ) async throws -> (response: TResponse, rawData: Data) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return (try JSONDecoder().decode(responseType, from: data), data)
    }

    public func deleteDecisionCheckAndReadBack(
        market: String, code: String, check: RecordedDecisionCheckReviewState, idempotencyKey: String
    ) async throws -> (deletion: DecisionReviewDeletionData, history: DecisionReviewHistoryEnvelope) {
        let url = decisionDeletionURL(market: market, code: code, checkId: check.id, reviewId: nil)
        let request = DeleteDecisionCheckRequest(expectedCheckedAt: check.checkedAt, idempotencyKey: idempotencyKey)
        return try await deleteDecisionReviewBody(url: url, body: request, market: market, code: code) { deletion in
            deletion.kind == "decision_check" && deletion.decisionCheckId == check.id
                && deletion.reviewId == nil && deletion.recordedAt == check.checkedAt
        }
    }

    public func deletePostDecisionReviewAndReadBack(
        market: String, code: String, checkId: String, review: PostDecisionReviewData, idempotencyKey: String
    ) async throws -> (deletion: DecisionReviewDeletionData, history: DecisionReviewHistoryEnvelope) {
        let url = decisionDeletionURL(market: market, code: code, checkId: checkId, reviewId: review.id)
        let request = DeletePostDecisionReviewRequest(expectedCreatedAt: review.createdAt, idempotencyKey: idempotencyKey)
        return try await deleteDecisionReviewBody(url: url, body: request, market: market, code: code) { deletion in
            deletion.kind == "post_decision_review" && deletion.decisionCheckId == checkId
                && deletion.reviewId == review.id && deletion.recordedAt == review.createdAt
        }
    }

    private func deleteDecisionReviewBody<Body: Encodable>(
        url: URL, body: Body, market: String, code: String,
        matches: (DecisionReviewDeletionData) -> Bool
    ) async throws -> (deletion: DecisionReviewDeletionData, history: DecisionReviewHistoryEnvelope) {
        let envelope = try await sendJSON(
            "POST", url: url, body: body,
            responseType: ResearchWriteEnvelope<DecisionReviewDeletionData>.self
        )
        guard envelope.status == "succeeded", envelope.source.actorType == "user", matches(envelope.data) else {
            throw DecisionReviewValidationError.invalid(["deletion write response does not match the exact selected record"])
        }
        var read = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &read)
        let (readData, readResponse) = try await session.data(for: read)
        try validate(response: readResponse)
        let deletion = try JSONDecoder().decode(DecisionReviewDeletionData.self, from: readData)
        var errors: [String] = []
        deletion.validate(expectedSymbol: "\(market).\(code)", errors: &errors)
        guard errors.isEmpty, deletion == envelope.data, matches(deletion) else {
            throw DecisionReviewValidationError.invalid(errors + ["deletion GET readback does not match POST"])
        }
        let history = try await fetchDecisionReviewHistory(market: market, code: code)
        guard history.deletions?.contains(deletion) == true else {
            throw DecisionReviewValidationError.invalid(["fresh review history does not contain the deletion tombstone"])
        }
        return (deletion, history)
    }

    private func decisionDeletionURL(market: String, code: String, checkId: String, reviewId: String?) -> URL {
        var url = researchProfileURL(market: market, code: code)
            .appending(path: "decision-checks").appending(path: checkId)
        if let reviewId { url = url.appending(path: "reviews").appending(path: reviewId) }
        return url.appending(path: "deletion")
    }
}
public enum ResearchClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
}

private struct SuggestionDecisionRequest: Encodable {
    let action: String
    let note: String?
}
