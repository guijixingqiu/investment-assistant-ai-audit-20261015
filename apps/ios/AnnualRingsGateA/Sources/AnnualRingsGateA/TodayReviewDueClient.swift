import Foundation

public protocol TodayReviewDueFetching: Sendable {
    func fetch(symbol: String) async -> TodayReviewDueEnvelope
}

public struct TodayReviewDueLoadGate: Equatable, Sendable {
    public struct Ticket: Equatable, Sendable {
        fileprivate let generation: Int
        public let symbol: String
    }

    private var generation = 0
    private var activeSymbol: String?

    public init() {}

    public mutating func begin(symbol: String) -> Ticket {
        generation += 1
        activeSymbol = symbol
        return Ticket(generation: generation, symbol: symbol)
    }

    public mutating func invalidate() {
        generation += 1
        activeSymbol = nil
    }

    public func accepts(
        _ ticket: Ticket,
        currentSymbol: String?,
        isCancelled: Bool
    ) -> Bool {
        !isCancelled
            && ticket.generation == generation
            && ticket.symbol == activeSymbol
            && ticket.symbol == currentSymbol
    }
}

public final class TodayReviewDueClient: TodayReviewDueFetching, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let authToken: String?
    private let authHeaderName: String
    private let now: @Sendable () -> Date

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        authToken: String? = nil,
        authHeaderName: String = "x-internal-token",
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
        self.authHeaderName = authHeaderName
        self.now = now
    }

    public func fetch(symbol: String) async -> TodayReviewDueEnvelope {
        guard SecuritySymbol.parseHongKongAlias(symbol)?.canonical == symbol else {
            return .unavailable(symbol, message: "尚未选择合法的 canonical 港股标的。")
        }
        guard var components = URLComponents(
            url: baseURL
                .appending(path: "api")
                .appending(path: "mobile")
                .appending(path: "research")
                .appending(path: "today"),
            resolvingAgainstBaseURL: false
        ) else {
            return .unavailable(symbol, message: "Today REVIEW_DUE URL 无效。")
        }
        components.queryItems = [URLQueryItem(name: "symbol", value: symbol)]
        guard let url = components.url else {
            return .unavailable(symbol, message: "Today REVIEW_DUE URL 无效。")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let authToken, !authToken.isEmpty {
            request.setValue(authToken, forHTTPHeaderField: authHeaderName)
        }
        do {
            let (data, response) = try await session.data(for: request)
            let envelope = try decode(data, expectedSymbol: symbol)
            guard let http = response as? HTTPURLResponse else {
                throw TodayReviewDueClientError.invalidResponse
            }
            if (200..<300).contains(http.statusCode) {
                return envelope
            }
            if envelope.status == .unavailable && [401, 403, 503].contains(http.statusCode) {
                return envelope
            }
            throw TodayReviewDueClientError.httpStatus(http.statusCode)
        } catch TodayReviewDueValidationError.invalid {
            return .unavailable(symbol, message: "Today REVIEW_DUE 响应语义无效，旧事件已清除。")
        } catch is DecodingError {
            return .unavailable(symbol, message: "Today REVIEW_DUE 响应格式无效，旧事件已清除。")
        } catch TodayReviewDueClientError.httpStatus(401),
                TodayReviewDueClientError.httpStatus(403) {
            return .unavailable(symbol, message: "未认证：需要读取授权；没有暴露旧决定或复盘事实。")
        } catch {
            return .unavailable(symbol, message: "Today REVIEW_DUE 离线或不可用，旧事件已清除。")
        }
    }

    private func decode(_ data: Data, expectedSymbol: String) throws -> TodayReviewDueEnvelope {
        try validateTodayReviewDueRawShape(data)
        let envelope = try JSONDecoder().decode(TodayReviewDueEnvelope.self, from: data)
        try envelope.validateForDisplay(expectedSymbol: expectedSymbol, now: now())
        return envelope
    }
}

public enum TodayReviewDueClientError: Error, Equatable, Sendable {
    case invalidResponse
    case httpStatus(Int)
}

private func validateTodayReviewDueRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw TodayReviewDueValidationError.invalid(["Today REVIEW_DUE must be an object"])
    }
    var errors: [String] = []
    rejectUnknown(root, allowed: [
        "schemaVersion", "status", "requestedSymbol", "metadata", "event",
        "advisoryOnly", "safety", "message"
    ], label: "envelope", errors: &errors)
    requireExactObject(root["metadata"], allowed: [
        "source", "asOf", "fetchedAt", "freshness", "provenance", "authority",
        "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"
    ], label: "metadata", errors: &errors)
    requireExactObject(root["safety"], allowed: [
        "createsOrder", "createsTrade", "mutatesCash", "writesFee",
        "mutatesPosition", "callsBroker"
    ], label: "safety", errors: &errors)
    if let event = root["event"] as? [String: Any] {
        let formalDecisionDue = event["type"] as? String == "FORMAL_DECISION_DUE"
        rejectUnknown(event, allowed: formalDecisionDue ? [
            "id", "type", "subject", "sourceEventId", "effectiveAt", "priority",
            "state", "stateChangedAt", "stateActor", "stateReason", "reportBinding"
        ] : [
            "id", "type", "subject", "sourceEventId", "effectiveAt", "priority",
            "state", "stateChangedAt", "stateActor", "stateReason", "bindings",
            "humanDecision", "researchReport"
        ], label: "event", errors: &errors)
        for (key, allowed) in [
            ("priority", ["severity", "dueAt"]),
            ("stateActor", ["actorType", "actorId"]),
            ("bindings", ["decisionCheckId", "reviewId"])
        ] {
            if let nested = event[key] as? [String: Any] {
                rejectUnknown(nested, allowed: allowed, label: "event.\(key)", errors: &errors)
            }
        }
        let bindingKeys = [
                "bindingVersion", "membershipId", "membershipVersion", "symbol",
                "evidencePackId", "evidencePackFingerprint", "reportId", "reportVersion",
                "contractVersion", "reportFingerprint", "reportDecisionId", "reportDecision",
                "reportDecisionActorType", "reportDecisionActorId", "decidedAt"
        ]
        if formalDecisionDue {
            requireExactObject(event["reportBinding"], allowed: bindingKeys,
                label: "event.reportBinding", errors: &errors)
        } else {
            if let humanDecision = event["humanDecision"] as? [String: Any] {
                rejectUnknown(humanDecision, allowed: [
                    "actionIntent", "humanCheckResult", "userFinalDecision", "reviewDueOn", "formalDecision"
                ], label: "event.humanDecision", errors: &errors)
                for key in ["actionIntent", "humanCheckResult", "userFinalDecision"] where humanDecision[key] == nil {
                    errors.append("event.humanDecision.\(key) is required")
                }
                if let formalDecision = humanDecision["formalDecision"] {
                    do { try validateFormalDecisionRawShape(formalDecision, label: "event.humanDecision.formalDecision") }
                    catch { errors.append("event.humanDecision.formalDecision is invalid") }
                }
            } else {
                errors.append("event.humanDecision must be an object")
            }
            requireExactObject(event["researchReport"], allowed: [
                "availability", "binding", "investmentThesis", "invalidationConditions",
                "nextValidationQuestion", "limitation"
            ], label: "event.researchReport", errors: &errors)
            if let report = event["researchReport"] as? [String: Any],
               report["availability"] as? String == "preserved" {
                requireExactObject(report["binding"], allowed: bindingKeys,
                    label: "event.researchReport.binding", errors: &errors)
            }
        }
    }
    if !errors.isEmpty {
        throw TodayReviewDueValidationError.invalid(errors)
    }
}

private func requireExactObject(
    _ candidate: Any?,
    allowed: [String],
    label: String,
    errors: inout [String]
) {
    guard let value = candidate as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    rejectUnknown(value, allowed: allowed, label: label, errors: &errors)
    for key in allowed where value[key] == nil {
        errors.append("\(label).\(key) is required")
    }
}

private func rejectUnknown(
    _ value: [String: Any],
    allowed: [String],
    label: String,
    errors: inout [String]
) {
    let allowedKeys = Set(allowed)
    for key in value.keys where !allowedKeys.contains(key) {
        errors.append("\(label).\(key) is not allowed")
    }
}
