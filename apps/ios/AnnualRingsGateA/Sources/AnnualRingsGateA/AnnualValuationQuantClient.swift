import Foundation

public protocol AnnualValuationQuantFetching: Sendable {
    func fetchAnnualValuationQuantWorkbench(
        membershipId: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput
    ) async -> AnnualValuationQuantWorkbenchEnvelope
}

/// Explicit registered quantitative research run. Viewing a report never calls
/// this; the Owner must trigger the run and confirm the current membership
/// version. The server decides everything that is executed.
///
/// The operation is fixed and preregistered, so it consumes no user valuation
/// or filter input. The response is the existing candidate decision-intake
/// envelope, whose decision context carries the frozen historical quant
/// evidence that was just published.
public protocol AnnualValuationQuantRunning: Sendable {
    func runRegisteredAnnualValuationQuant(
        membershipId: String,
        membershipVersion: Int,
        idempotencyKey: String
    ) async -> CandidateDecisionIntakeEnvelope
}

public final class AnnualValuationQuantClient: AnnualValuationQuantFetching, AnnualValuationQuantRunning, @unchecked Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let authToken: String?
    private let authHeaderName: String
    private let writeAuthToken: String?
    private let writeAuthHeaderName: String

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
        self.authHeaderName = authHeaderName
        self.writeAuthToken = writeAuthToken
        self.writeAuthHeaderName = writeAuthHeaderName ?? authHeaderName
    }

    public func fetchAnnualValuationQuantWorkbench(
        membershipId: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput
    ) async -> AnnualValuationQuantWorkbenchEnvelope {
        guard let url = workbenchURL(membershipId: membershipId, valuation: valuation, quantFilter: quantFilter) else {
            return .unavailable("估值与量化输入无法编码，未发送请求。", membershipId: membershipId, clientFailureState: "malformed")
        }
        var request = URLRequest(url: url)
        if let authToken, !authToken.isEmpty {
            request.setValue(authToken, forHTTPHeaderField: authHeaderName)
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unavailable(
                    "估值与量化响应缺少有效 HTTP 状态，已阻止展示。",
                    membershipId: membershipId
                )
            }
            if !(200..<300).contains(http.statusCode) {
                return failClosedHTTPResponse(
                    data,
                    statusCode: http.statusCode,
                    membershipId: membershipId
                )
            }
            return try decode(data, membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("估值与量化响应格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch AnnualValuationQuantValidationError.invalid {
            return .unavailable("估值与量化响应语义或可复算性无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch {
            return .unavailable("估值与量化工作台离线或不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "offline")
        }
    }

    public func runRegisteredAnnualValuationQuant(
        membershipId: String,
        membershipVersion: Int,
        idempotencyKey: String
    ) async -> CandidateDecisionIntakeEnvelope {
        // No valuation or filter query: a preregistered run must not require
        // user scenario input, and the server rejects nothing here for its
        // absence.
        let url = registeredRunURL(membershipId: membershipId)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let writeAuthToken, !writeAuthToken.isEmpty {
            request.setValue(writeAuthToken, forHTTPHeaderField: writeAuthHeaderName)
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "membershipVersion": membershipVersion,
            "ownerConfirmed": true,
            "idempotencyKey": idempotencyKey
        ])
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unavailable("注册研究响应缺少有效 HTTP 状态，已阻止展示。", membershipId: membershipId)
            }
            if !(200..<300).contains(http.statusCode) {
                let failureState = researchHTTPFailureState(http.statusCode)
                let decoded = try? decodeRegisteredRunIntake(data, membershipId: membershipId)
                let safeMessage = decoded.flatMap { envelope in
                    envelope.status == .available ? nil : envelope.message
                }
                return .unavailable(
                    safeMessage ?? httpFailureMessage(for: failureState),
                    membershipId: membershipId,
                    clientFailureState: failureState
                )
            }
            return try decodeRegisteredRunIntake(data, membershipId: membershipId)
        } catch is DecodingError {
            return .unavailable("注册研究响应格式无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch CandidateDecisionIntakeValidationError.invalid {
            return .unavailable("注册研究响应语义或可复算性无效，已阻止展示。", membershipId: membershipId, clientFailureState: "malformed")
        } catch {
            return .unavailable("注册研究运行不可用：\(error.localizedDescription)", membershipId: membershipId, clientFailureState: "offline")
        }
    }

    /// The registered run reuses the existing candidate decision-intake read
    /// contract; only the membership binding is re-checked locally.
    private func decodeRegisteredRunIntake(_ data: Data, membershipId: String) throws -> CandidateDecisionIntakeEnvelope {
        let envelope = try JSONDecoder().decode(CandidateDecisionIntakeEnvelope.self, from: data)
        try envelope.validateForDisplay()
        guard envelope.membershipId == membershipId else {
            throw CandidateDecisionIntakeValidationError.invalid(["response membershipId must match requested membershipId"])
        }
        return envelope
    }

    private func registeredRunURL(membershipId: String) -> URL {
        baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "valuation-quant-workbench")
            .appending(path: "refresh")
    }

    private func failClosedHTTPResponse(
        _ data: Data,
        statusCode: Int,
        membershipId: String
    ) -> AnnualValuationQuantWorkbenchEnvelope {
        let failureState = researchHTTPFailureState(statusCode)
        let decoded = try? decode(data, membershipId: membershipId)
        let safeMessage = decoded.flatMap { envelope in
            envelope.status != "available" && envelope.data == nil ? envelope.message : nil
        }
        return .unavailable(
            safeMessage ?? httpFailureMessage(for: failureState),
            membershipId: membershipId,
            clientFailureState: failureState
        )
    }

    private func httpFailureMessage(for failureState: String) -> String {
        switch failureState {
        case "unauthorized":
            return "未认证：需要读取授权后查看估值与量化工作台。"
        case "malformed":
            return "估值与量化输入无效，已阻止展示旧结果。"
        case "not_found":
            return "研究自选成员不存在，已阻止展示旧结果。"
        case "conflict":
            return "估值与量化事实冲突，已阻止展示旧结果。"
        default:
            return "估值与量化工作台不可用，已阻止展示旧结果。"
        }
    }

    private func decode(_ data: Data, membershipId: String) throws -> AnnualValuationQuantWorkbenchEnvelope {
        try validateAnnualValuationQuantRawShape(data)
        let envelope = try JSONDecoder().decode(AnnualValuationQuantWorkbenchEnvelope.self, from: data)
        return try envelope.validated(expectedMembershipId: membershipId)
    }

    private func workbenchURL(
        membershipId: String,
        valuation: AnnualValuationScenarioInput,
        quantFilter: AnnualQuantFilterInput
    ) -> URL? {
        let url = baseURL
            .appending(path: "api")
            .appending(path: "mobile")
            .appending(path: "research")
            .appending(path: "candidate-memberships")
            .appending(path: membershipId)
            .appending(path: "valuation-quant-workbench")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "methodId", value: valuation.methodId),
            URLQueryItem(name: "baseMetricPerShare", value: String(valuation.baseMetricPerShare)),
            URLQueryItem(name: "metricCurrency", value: valuation.metricCurrency),
            URLQueryItem(name: "annualGrowthRate", value: String(valuation.annualGrowthRate)),
            URLQueryItem(name: "horizonYears", value: String(valuation.horizonYears)),
            URLQueryItem(name: "terminalMultiple", value: String(valuation.terminalMultiple)),
            URLQueryItem(name: "annualDiscountRate", value: String(valuation.annualDiscountRate)),
            URLQueryItem(name: "netCashPerShare", value: String(valuation.netCashPerShare)),
            URLQueryItem(name: "growthRateStep", value: String(valuation.growthRateStep)),
            URLQueryItem(name: "multipleStep", value: String(valuation.multipleStep)),
            URLQueryItem(name: "maxDrawdownMagnitude", value: String(quantFilter.maxDrawdownMagnitude)),
            URLQueryItem(name: "maxTurnoverOneWay", value: String(quantFilter.maxTurnoverOneWay)),
            URLQueryItem(name: "minTradeCount", value: String(quantFilter.minTradeCount))
        ].filter { $0.value != nil }
        return components?.url
    }
}

func validateAnnualValuationQuantRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw AnnualValuationQuantValidationError.invalid(["workbench response must be a JSON object"])
    }
    try validateAnnualValuationQuantRawObject(root)
}

func validateAnnualValuationQuantRawObject(_ root: [String: Any]) throws {
    var errors: [String] = []
    annualExactKeys(
        root,
        allowed: ["schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId", "requestedSymbol", "metadata", "data", "safety", "message"],
        label: "workbench",
        errors: &errors
    )
    annualExactObjectKeys(
        root["metadata"],
        allowed: ["source", "asOf", "fetchedAt", "freshness", "provenance", "authority", "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"],
        label: "workbench metadata",
        errors: &errors
    )
    annualExactObjectKeys(
        root["safety"],
        allowed: ["advisoryOnly", "userInputsRequired", "changesCandidateOrdering", "recommendation", "ranking", "score", "targetPrice", "targetPosition", "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio"],
        label: "workbench safety",
        errors: &errors
    )
    if let payload = root["data"] as? [String: Any] {
        annualExactKeys(payload, allowed: ["target", "sourceIdentity", "valuation", "quant"], label: "workbench data", errors: &errors)
        annualExactObjectKeys(
            payload["target"],
            allowed: ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"],
            label: "workbench target",
            errors: &errors
        )
        annualExactObjectKeys(
            payload["sourceIdentity"],
            allowed: ["decisionContextId", "decisionContextHash", "generatedAt"],
            label: "workbench source identity",
            errors: &errors
        )
        if let valuation = payload["valuation"] as? [String: Any] {
            annualExactKeys(valuation, allowed: ["status", "quote", "inputs", "method", "outputs", "sensitivity", "limitations"], label: "valuation", errors: &errors)
            annualExactObjectKeys(
                valuation["quote"],
                allowed: ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"],
                label: "valuation quote",
                errors: &errors
            )
            annualExactObjectKeys(
                valuation["inputs"],
                allowed: ["methodId", "metricCurrency", "shareBasis", "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple", "annualDiscountRate", "netCashPerShare", "growthRateStep", "multipleStep"],
                optional: ["methodId", "metricCurrency", "shareBasis"],
                label: "valuation inputs",
                errors: &errors
            )
            annualExactObjectKeys(
                valuation["method"],
                allowed: ["id", "calculationVersion", "presentValueFormula", "impliedExpectationFormula", "rounding", "applicability"],
                optional: ["applicability"],
                label: "valuation method",
                errors: &errors
            )
            annualExactObjectKeys(
                valuation["outputs"],
                allowed: ["projectedMetricPerShare", "scenarioPresentValuePerShare", "impliedAnnualGrowthRateAtCurrentPrice", "impliedExpectationStatus", "valueRange"],
                optional: ["valueRange"],
                label: "valuation outputs",
                errors: &errors
            )
            if let method = valuation["method"] as? [String: Any] {
                annualExactObjectKeys(
                    method["applicability"],
                    allowed: ["ownerConfirmed", "companyDataBasis", "requiredAnchorMetrics", "limitation"],
                    label: "valuation method applicability",
                    errors: &errors
                )
            }
            if let outputs = valuation["outputs"] as? [String: Any] {
                annualExactObjectKeys(
                    outputs["valueRange"],
                    allowed: ["low", "high", "interpretation"],
                    label: "valuation value range",
                    errors: &errors
                )
            }
            if let sensitivity = valuation["sensitivity"] as? [String: Any] {
                annualExactKeys(
                    sensitivity,
                    allowed: ["growthRates", "terminalMultiples", "cells"],
                    label: "valuation sensitivity",
                    errors: &errors
                )
                annualExactArrayObjectKeys(
                    sensitivity["cells"],
                    allowed: ["annualGrowthRate", "terminalMultiple", "presentValuePerShare"],
                    label: "valuation sensitivity cell",
                    errors: &errors
                )
            }
        }
        if let quant = payload["quant"] as? [String: Any] {
            annualExactKeys(quant, allowed: ["status", "evidence", "model", "diagnostics", "filter", "limitations"], label: "quant", errors: &errors)
            annualExactObjectKeys(
                quant["model"],
                allowed: ["modelVersion", "universe", "sourceClassification", "adjustment", "dataCutoff", "snapshotId", "snapshotHash", "codeIdentity"],
                label: "quant model",
                errors: &errors
            )
            if let diagnostics = quant["diagnostics"] as? [String: Any] {
                annualExactKeys(
                    diagnostics,
                    allowed: ["benchmark", "sampleSize", "concentration", "parameterNeighborhood", "marketEnvironment", "failedExperiments"],
                    label: "quant diagnostics",
                    errors: &errors
                )
                for field in ["benchmark", "sampleSize", "concentration", "parameterNeighborhood", "marketEnvironment"] {
                    annualExactObjectKeys(
                        diagnostics[field],
                        allowed: ["status", "limitation"],
                        label: "quant diagnostics \(field)",
                        errors: &errors
                    )
                }
                annualExactObjectKeys(
                    diagnostics["failedExperiments"],
                    allowed: ["status", "experimentIds", "limitation"],
                    label: "quant failed experiments",
                    errors: &errors
                )
            }
            if let filter = quant["filter"] as? [String: Any] {
                annualExactKeys(filter, allowed: ["status", "criteria", "samples", "preservesSourceOrder", "ranking", "score", "recommendation"], label: "quant filter", errors: &errors)
                annualExactObjectKeys(
                    filter["criteria"],
                    allowed: ["maxDrawdownMagnitude", "maxTurnoverOneWay", "minTradeCount"],
                    label: "quant filter criteria",
                    errors: &errors
                )
                annualExactArrayObjectKeys(
                    filter["samples"],
                    allowed: ["sampleId", "sourceIndex", "maxDrawdownMagnitude", "turnoverOneWay", "tradeCount", "matchesMaxDrawdown", "matchesMaxTurnover", "matchesMinTradeCount", "allCriteriaMatched"],
                    label: "quant filter sample",
                    errors: &errors
                )
            }
            if let evidence = quant["evidence"] as? [String: Any] {
                annualExactKeys(
                    evidence,
                    allowed: ["status", "metadata", "identities", "sampleBoundary", "limitations", "authority", "decisionEvidence", "comparison", "message"],
                    optional: ["decisionEvidence", "comparison"],
                    label: "quant evidence",
                    errors: &errors
                )
                annualExactObjectKeys(
                    evidence["metadata"],
                    allowed: ["source", "asOf", "fetchedAt", "freshness", "provenance", "authority", "stale", "missing", "conflict", "fixture", "correctionOf", "replaces", "message"],
                    label: "quant evidence metadata",
                    errors: &errors
                )
                if let identities = evidence["identities"] as? [String: Any] {
                    annualExactKeys(
                        identities,
                        allowed: ["frozenSnapshot", "baselineExperimentIdentity", "splitIds", "shadowPortfolioIdentity", "shadowPortfolioId", "generatedAt", "hkConnectUniverse"],
                        optional: ["hkConnectUniverse"],
                        label: "quant evidence identities",
                        errors: &errors
                    )
                    annualExactObjectKeys(
                        identities["frozenSnapshot"],
                        allowed: ["snapshotId", "snapshotHash", "dataHash", "sourceClassification"],
                        label: "quant evidence frozen snapshot",
                        errors: &errors
                    )
                    annualExactObjectKeys(
                        identities["hkConnectUniverse"],
                        allowed: ["source", "snapshotId", "effectiveDate", "capturedAt", "memberCount", "sourceUrls"],
                        label: "quant evidence official Hong Kong Connect universe",
                        errors: &errors
                    )
                }
                annualExactObjectKeys(
                    evidence["sampleBoundary"],
                    allowed: ["universe", "sourceClassification", "finalTestPolicy", "limitation"],
                    label: "quant evidence sample boundary",
                    errors: &errors
                )
                annualExactObjectKeys(
                    evidence["authority"],
                    allowed: [
                        "researchOnly", "advisoryOnly", "changesCandidateOrdering", "changesMembershipState",
                        "changesHumanReviewResult", "mutatesLocalRecord", "officialReviewFact", "officialPortfolioFact",
                        "brokerWrite", "recommendation", "ranking", "score", "allocation", "sizing", "targetPrice",
                        "buySellHold", "orderTradeFillAuthority", "cashFeePositionMutation"
                    ],
                    label: "quant evidence authority",
                    errors: &errors
                )
                if let comparison = evidence["comparison"] as? [String: Any] {
                    annualExactKeys(comparison, allowed: ["snapshotId", "dataHash", "feePolicySha256", "dividendCashPolicySha256", "observationStartDate", "observationEndDate", "registryId", "selectionPolicy", "selectionWindow", "experiments", "benchmark", "returnBasis", "preservesSourceOrder", "ranking", "recommendation"], label: "quant comparison", errors: &errors)
                    annualExactObjectKeys(comparison["selectionWindow"], allowed: ["start", "end"], label: "quant comparison window", errors: &errors)
                    annualExactArrayObjectKeys(comparison["experiments"], allowed: ["id", "disposition", "reason", "signal", "finalTestUsedForSelection", "metrics"], label: "quant comparison experiment", errors: &errors)
                    for experiment in comparison["experiments"] as? [[String: Any]] ?? [] {
                        annualExactObjectKeys(experiment["signal"], allowed: ["name", "buyWhenPreviousCloseReturnLte", "sellWhenPreviousCloseReturnGte"], label: "quant experiment signal", errors: &errors)
                        annualExactObjectKeys(experiment["metrics"], allowed: ["totalReturn", "maxDrawdown", "totalFees", "turnoverOneWay", "tradeCount", "closedRoundTripCount"], label: "quant experiment metrics", errors: &errors)
                    }
                    annualExactObjectKeys(comparison["benchmark"], allowed: ["evidenceId", "symbol", "name", "sourceSha256", "seriesHash", "calculationPolicy", "periods"], label: "quant benchmark", errors: &errors)
                    if let benchmark = comparison["benchmark"] as? [String: Any] {
                        annualExactArrayObjectKeys(benchmark["periods"], allowed: ["id", "start", "end", "simulatedStrategyTotalReturn", "benchmarkTotalReturn", "difference", "usedForParameterSelection"], label: "quant benchmark period", errors: &errors)
                    }
                }
                errors.append(contentsOf: quantDecisionEvidenceRawErrors(context: ["quantEvidence": evidence], label: "valuation quant workbench"))
            }
        }
    }
    if errors.isEmpty == false { throw AnnualValuationQuantValidationError.invalid(errors) }
}

private func annualExactObjectKeys(
    _ value: Any?,
    allowed: Set<String>,
    optional: Set<String> = [],
    label: String,
    errors: inout [String]
) {
    guard let object = value as? [String: Any] else { return }
    annualExactKeys(object, allowed: allowed, optional: optional, label: label, errors: &errors)
}

private func annualExactArrayObjectKeys(
    _ value: Any?,
    allowed: Set<String>,
    label: String,
    errors: inout [String]
) {
    guard let values = value as? [Any] else { return }
    for (index, item) in values.enumerated() {
        annualExactObjectKeys(item, allowed: allowed, label: "\(label) \(index)", errors: &errors)
    }
}

private func annualExactKeys(
    _ value: [String: Any],
    allowed: Set<String>,
    optional: Set<String> = [],
    label: String,
    errors: inout [String]
) {
    for key in value.keys where allowed.contains(key) == false {
        errors.append("\(label) contains unsupported field \(key)")
    }
    for key in allowed where optional.contains(key) == false && value.keys.contains(key) == false {
        errors.append("\(label) is missing field \(key)")
    }
}
