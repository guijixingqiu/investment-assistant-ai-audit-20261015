import Foundation

func validateAnnualPortfolioLabRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw AnnualPortfolioLabValidationError.invalid(["portfolio lab response must be a JSON object"])
    }
    try validateAnnualPortfolioLabRawObject(root)
}

func validateAnnualPortfolioLabRawObject(_ root: [String: Any]) throws {
    var errors: [String] = []
    annualPortfolioLabExact(root, keys: [
        "schemaVersion", "calculationVersion", "generatedAt", "status", "labId", "membershipId",
        "requestedActorId", "requestedSymbol", "data", "gaps", "safety", "message"
    ], label: "portfolio lab", errors: &errors)
    annualPortfolioLabObject(root["safety"], keys: [
        "advisoryOnly", "userProvidedAmountsOnly", "preservesScenarioOrder", "changesCandidateOrdering",
        "recommendation", "ranking", "score", "suggestedAmount", "targetWeight", "targetPrice",
        "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio", "productionWrite"
    ], label: "portfolio lab safety", errors: &errors)
    if let payload = root["data"] as? [String: Any] {
        validateAnnualPortfolioLabPayload(payload, errors: &errors)
    }
    if let labId = root["labId"] as? String {
        do {
            let expected = try portfolioDecisionContentId(
                object: root,
                prefix: "annual-portfolio-lab:",
                excludingTopLevelKeys: ["labId", "generatedAt"]
            )
            if labId != expected { errors.append("portfolio lab labId does not match canonical content") }
        } catch {
            errors.append("portfolio lab canonical identity cannot be recomputed")
        }
    }
    if !errors.isEmpty { throw AnnualPortfolioLabValidationError.invalid(errors) }
}

private func validateAnnualPortfolioLabPayload(_ payload: [String: Any], errors: inout [String]) {
    annualPortfolioLabExact(payload, keys: ["target", "sourceIdentity", "portfolio", "dimensions", "current", "scenarios", "quant"], label: "portfolio lab data", errors: &errors)
    annualPortfolioLabObject(payload["target"], keys: ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], label: "portfolio lab target", errors: &errors)
    if let source = payload["sourceIdentity"] as? [String: Any] {
        annualPortfolioLabExact(source, keys: ["accountScopeId", "portfolioContextId", "portfolioSnapshotId", "portfolioAsOf", "decisionContextId", "decisionContextHash", "quote"], label: "portfolio lab sourceIdentity", errors: &errors)
        annualPortfolioLabObject(source["quote"], keys: ["snapshotId", "symbol", "currency", "price", "quoteTime", "fetchedAt", "source"], label: "portfolio lab quote identity", errors: &errors)
    } else { errors.append("portfolio lab sourceIdentity must be an object") }
    if let portfolio = payload["portfolio"] as? [String: Any] {
        validateAnnualPortfolioLabPortfolio(portfolio, errors: &errors)
    } else { errors.append("portfolio lab portfolio must be an object") }
    if let dimensions = payload["dimensions"] as? [String: Any] {
        annualPortfolioLabExact(dimensions, keys: ["positions", "candidate", "currency"], label: "portfolio lab dimensions", errors: &errors)
        annualPortfolioLabArrayObjects(dimensions["positions"], keys: ["sourceIndex", "symbol", "name", "currency", "marketValue", "marketWeight", "sector"], label: "portfolio lab position dimension", errors: &errors) { item, index, nestedErrors in
            annualPortfolioLabObject(item["sector"], keys: ["status", "value", "limitation"], label: "portfolio lab position sector \(index)", errors: &nestedErrors)
        }
        if let candidate = dimensions["candidate"] as? [String: Any] {
            annualPortfolioLabExact(candidate, keys: ["symbol", "name", "currency", "currentlyHeld", "sector"], label: "portfolio lab candidate dimension", errors: &errors)
            annualPortfolioLabObject(candidate["sector"], keys: ["status", "value", "limitation"], label: "portfolio lab candidate sector", errors: &errors)
        } else { errors.append("portfolio lab candidate dimension must be an object") }
        if let currency = dimensions["currency"] as? [String: Any] {
            annualPortfolioLabExact(currency, keys: ["status", "currencies", "marketValueByCurrency"], label: "portfolio lab currency dimension", errors: &errors)
            annualPortfolioLabArrayObjects(currency["marketValueByCurrency"], keys: ["currency", "marketValue", "weight"], label: "portfolio lab currency row", errors: &errors)
        } else { errors.append("portfolio lab currency dimension must be an object") }
    } else { errors.append("portfolio lab dimensions must be an object") }
    if let current = payload["current"] as? [String: Any] {
        annualPortfolioLabExact(current, keys: ["totalMarketValue", "candidateMarketValue", "candidateWeight", "largestPositionWeight", "hhi", "historical"], label: "portfolio lab current", errors: &errors)
        annualPortfolioLabObject(current["historical"], keys: annualPortfolioLabHistoricalKeys, label: "portfolio lab current historical", errors: &errors)
    } else { errors.append("portfolio lab current must be an object") }
    if let scenarios = payload["scenarios"] as? [[String: Any]] {
        for (index, scenario) in scenarios.enumerated() {
            annualPortfolioLabExact(scenario, keys: ["sourceIndex", "scenarioId", "hypotheticalAmount", "riskImpact", "comparison", "historical"], label: "portfolio lab scenario \(index)", errors: &errors)
            if let risk = scenario["riskImpact"] as? [String: Any] {
                validateAnnualPortfolioLabRisk(risk, label: "portfolio lab scenario \(index) risk", errors: &errors)
            } else { errors.append("portfolio lab scenario \(index) risk must be an object") }
            if let comparison = scenario["comparison"] as? [String: Any] {
                annualPortfolioLabExact(comparison, keys: ["candidateWeightChange", "largestPositionWeightChange", "hhiChange", "otherPositionWeightChanges", "fundingSourceStatus", "cashStatus", "opportunityCostLimitation"], label: "portfolio lab scenario \(index) comparison", errors: &errors)
                annualPortfolioLabArrayObjects(comparison["otherPositionWeightChanges"], keys: ["symbol", "currentWeight", "scenarioWeight", "weightChange"], label: "portfolio lab scenario \(index) position change", errors: &errors)
            } else { errors.append("portfolio lab scenario \(index) comparison must be an object") }
            annualPortfolioLabObject(scenario["historical"], keys: annualPortfolioLabHistoricalKeys + ["annualizedVolatilityChange", "historicalStressLossChange", "historicalTailLossChange", "candidateRiskContributionChange"], label: "portfolio lab scenario \(index) historical", errors: &errors)
            if let scenarioId = scenario["scenarioId"] as? String {
                do {
                    let expected = try portfolioDecisionContentId(object: scenario, prefix: "annual-portfolio-scenario:", excludingTopLevelKeys: ["scenarioId"])
                    if scenarioId != expected { errors.append("portfolio lab scenario \(index) scenarioId does not match canonical content") }
                } catch { errors.append("portfolio lab scenario \(index) canonical identity cannot be recomputed") }
            }
        }
    } else { errors.append("portfolio lab scenarios must be an array of objects") }
    if let quant = payload["quant"] as? [String: Any] {
        validateAnnualPortfolioLabQuant(quant, errors: &errors)
    } else { errors.append("portfolio lab quant must be an object") }
}

private let annualPortfolioLabHistoricalKeys = [
    "status", "annualizedVolatility", "historicalStressLossMagnitude", "historicalStressDate",
    "historicalTailLossMagnitude", "candidateRiskContribution", "limitation"
]

private func validateAnnualPortfolioLabPortfolio(_ portfolio: [String: Any], errors: inout [String]) {
    let provenanceKeys: Set<String> = ["sourceAsOf", "importedAt", "fetchedAt", "freshness"]
    annualPortfolioLabExact(portfolio, keys: ["schemaVersion", "status", "contextId", "portfolioSnapshotId", "accountScopeId", "portfolioSource", "sourceAsOf", "portfolioAsOf", "importedAt", "fetchedAt", "freshness", "assembledAt", "positions", "summary", "dataUse", "gaps", "message"], optional: provenanceKeys, label: "portfolio context", errors: &errors)
    if let freshness = portfolio["freshness"] as? [String: Any] {
        annualPortfolioLabExact(freshness, keys: ["state", "mode", "reason", "evaluatedAt", "ageSeconds", "tradingMaxAgeSeconds", "latestSessionClose"], label: "portfolio freshness", errors: &errors)
    }
    annualPortfolioLabArrayObjects(portfolio["positions"], keys: ["market", "code", "symbol", "name", "quantity", "averageCost", "unrealizedPnl", "sourceWeight", "currency", "sourceRowId", "quote", "latestPrice", "marketValue", "marketWeight"], label: "portfolio position", errors: &errors) { position, index, nestedErrors in
        annualPortfolioLabObject(position["quote"], keys: ["status", "source", "quoteAsOf", "fetchedAt"], label: "portfolio position quote \(index)", errors: &nestedErrors)
    }
    if let summary = portfolio["summary"] as? [String: Any] {
        annualPortfolioLabExact(summary, keys: ["positionCount", "marketValue", "cash", "unrealizedPnl", "concentration"], optional: ["unrealizedPnl"], label: "portfolio summary", errors: &errors)
        annualPortfolioLabObject(summary["marketValue"], keys: ["status", "amount", "currency", "missingPositionCount"], label: "portfolio market value", errors: &errors)
        annualPortfolioLabObject(summary["cash"], keys: ["status", "amount", "currency", "reason"], label: "portfolio cash", errors: &errors)
        annualPortfolioLabObject(summary["concentration"], keys: ["status", "largestPositionWeight", "topThreeWeight", "hhi"], label: "portfolio concentration", errors: &errors)
    } else { errors.append("portfolio summary must be an object") }
    annualPortfolioLabObject(portfolio["dataUse"], keys: ["display", "advisoryRiskImpact", "productionPortfolio", "brokerReconciliation", "accounting", "execution"], label: "portfolio dataUse", errors: &errors)
    if let contextId = portfolio["contextId"] as? String {
        do {
            let expected = try portfolioDecisionContextContentId(object: portfolio)
            if contextId != expected { errors.append("nested portfolio contextId does not match canonical content") }
        } catch { errors.append("nested portfolio canonical identity cannot be recomputed") }
    }
}

private func validateAnnualPortfolioLabRisk(_ risk: [String: Any], label: String, errors: inout [String]) {
    annualPortfolioLabExact(risk, keys: ["schemaVersion", "calculationVersion", "status", "impactId", "contextId", "portfolioSnapshotId", "candidateSymbol", "hypotheticalAmount", "currency", "current", "scenario", "gaps", "guardrails", "message"], label: label, errors: &errors)
    annualPortfolioLabObject(risk["current"], keys: ["alreadyHeld", "marketValue", "weight"], label: "\(label) current", errors: &errors)
    annualPortfolioLabObject(risk["scenario"], keys: ["totalMarketValue", "candidateMarketValue", "candidateWeight", "weightChange", "largestPositionWeight", "hhi"], label: "\(label) scenario", errors: &errors)
    annualPortfolioLabObject(risk["guardrails"], keys: ["advisoryOnly", "userProvidedAmountOnly", "generatesDirection", "recommendsAmount", "recommendsTargetWeight", "recommendsTiming", "promisesReturn", "createsOrder", "productionWrite"], label: "\(label) guardrails", errors: &errors)
    if let impactId = risk["impactId"] as? String {
        do {
            let expected = try portfolioDecisionContentId(object: risk, prefix: "portfolio-risk-impact:", excludingTopLevelKeys: ["impactId"])
            if impactId != expected { errors.append("\(label) impactId does not match canonical content") }
        } catch { errors.append("\(label) canonical identity cannot be recomputed") }
    }
}

private func validateAnnualPortfolioLabQuant(_ quant: [String: Any], errors: inout [String]) {
    annualPortfolioLabExact(quant, keys: ["evidenceStatus", "evidence", "coverage", "correlations", "candidateLiquidity", "limitations"], label: "portfolio lab quant", errors: &errors)
    annualPortfolioLabObject(quant["coverage"], keys: ["status", "requiredSymbols", "coveredSymbols", "missingSymbols", "extraEvidenceSymbols"], label: "portfolio lab quant coverage", errors: &errors)
    if let correlations = quant["correlations"] as? [String: Any] {
        annualPortfolioLabExact(correlations, keys: ["status", "observationStartDate", "observationEndDate", "observationCount", "stability", "candidateToPositions", "limitation"], label: "portfolio lab correlations", errors: &errors)
        annualPortfolioLabArrayObjects(correlations["candidateToPositions"], keys: ["symbol", "correlation"], label: "portfolio lab correlation", errors: &errors)
    } else { errors.append("portfolio lab correlations must be an object") }
    if let liquidity = quant["candidateLiquidity"] as? [String: Any] {
        annualPortfolioLabExact(liquidity, keys: ["status", "symbol", "observationCount", "medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount", "boardLot", "feeCurrency", "nonZeroCosts", "fees", "limitation"], label: "portfolio lab liquidity", errors: &errors)
        if !(liquidity["fees"] is NSNull) {
            annualPortfolioLabObject(liquidity["fees"], keys: annualPortfolioLabFeeKeys, label: "portfolio lab liquidity fees", errors: &errors)
        }
    } else { errors.append("portfolio lab liquidity must be an object") }
    if let evidence = quant["evidence"] as? [String: Any] {
        validateAnnualPortfolioLabEvidence(evidence, errors: &errors)
    }
}

private let annualPortfolioLabFeeKeys = [
    "commissionRate", "minCommission", "platformFee", "stampDutyRate", "tradingFeeRate", "transactionLevyRate"
]

private func validateAnnualPortfolioLabEvidence(_ evidence: [String: Any], errors: inout [String]) {
    annualPortfolioLabExact(evidence, keys: ["schemaVersion", "generatedAt", "feePolicyVersion", "feePolicySha256", "executionCalendar", "source", "method", "stability", "dailyReturns", "series", "covariance", "executionEvidence", "codeIdentity", "authority", "limitations", "safety", "evidenceId"], label: "portfolio lab quant evidence", errors: &errors)
    annualPortfolioLabObject(evidence["executionCalendar"], keys: ["timing", "calendarCompleteness"], label: "portfolio lab quant execution calendar", errors: &errors)
    if let source = evidence["source"] as? [String: Any] {
        annualPortfolioLabExact(source, keys: ["snapshotId", "snapshotHash", "dataHash", "sourceClassification", "adjustment", "dataCutoff", "observationStartDate", "observationEndDate", "hkConnectUniverse", "universe", "sourceIdentity"], optional: ["hkConnectUniverse"], label: "portfolio lab quant source", errors: &errors)
        if let universe = source["hkConnectUniverse"] {
            annualPortfolioLabObject(universe, keys: ["source", "snapshotId", "effectiveDate", "capturedAt", "memberCount", "sourceUrls"], label: "portfolio lab official Hong Kong Connect universe", errors: &errors)
        }
        annualPortfolioLabArrayObjects(source["universe"], keys: ["market", "code", "symbol", "name", "boardLot"], label: "portfolio lab quant universe", errors: &errors)
        annualPortfolioLabObject(source["sourceIdentity"], keys: ["source", "classification", "provenance", "authority", "asOf", "fetchedAt", "externalFetch", "sourceKind", "sourcePath", "sourceHash", "authorizationId"], optional: ["authorizationId"], label: "portfolio lab quant sourceIdentity", errors: &errors)
    } else { errors.append("portfolio lab quant source must be an object") }
    annualPortfolioLabObject(evidence["method"], keys: ["returnMethod", "annualizationDays", "tailConfidence", "covarianceEstimator", "observationAlignment", "observationCount", "commonTradingDates"], label: "portfolio lab quant method", errors: &errors)
    annualPortfolioLabObject(evidence["stability"], keys: ["status", "minimumStableObservationCount", "observationCount", "limitation"], label: "portfolio lab quant stability", errors: &errors)
    annualPortfolioLabArrayObjects(evidence["dailyReturns"], keys: ["tradeDate", "values"], label: "portfolio lab daily return", errors: &errors) { row, index, nestedErrors in
        annualPortfolioLabArrayObjects(row["values"], keys: ["symbol", "previousClose", "close", "volume", "turnover", "value"], label: "portfolio lab daily return value \(index)", errors: &nestedErrors)
    }
    annualPortfolioLabArrayObjects(evidence["series"], keys: ["symbol", "boardLot", "annualizedVolatility", "worstDailyReturn", "historicalTailLossMagnitude", "liquidity"], label: "portfolio lab quant series", errors: &errors) { item, index, nestedErrors in
        annualPortfolioLabObject(item["liquidity"], keys: ["medianDailyVolume", "medianDailyTurnover", "minimumDailyVolume", "minimumDailyTurnover", "zeroVolumeObservationCount"], label: "portfolio lab quant series liquidity \(index)", errors: &nestedErrors)
    }
    annualPortfolioLabArrayObjects(evidence["covariance"], keys: ["leftSymbol", "rightSymbol", "annualizedCovariance", "correlation"], label: "portfolio lab covariance", errors: &errors)
    if let execution = evidence["executionEvidence"] as? [String: Any] {
        annualPortfolioLabExact(execution, keys: ["boardLots", "feeCurrency", "nonZeroCosts", "fees", "signalTiming", "earliestExecution", "allowsSameBarExecution", "allowsMargin"], label: "portfolio lab executionEvidence", errors: &errors)
        annualPortfolioLabArrayObjects(execution["boardLots"], keys: ["symbol", "boardLot"], label: "portfolio lab board lot", errors: &errors)
        annualPortfolioLabObject(execution["fees"], keys: annualPortfolioLabFeeKeys, label: "portfolio lab fees", errors: &errors)
    } else { errors.append("portfolio lab executionEvidence must be an object") }
    annualPortfolioLabObject(evidence["codeIdentity"], keys: ["scriptPath", "scriptHash", "configPath", "configHash"], label: "portfolio lab codeIdentity", errors: &errors)
    annualPortfolioLabObject(evidence["authority"], keys: ["researchOnly", "advisoryOnly", "currentPortfolioFact", "brokerReconciliation", "accountingAuthority", "recommendation", "ranking", "score", "allocation", "sizing", "targetPrice", "tradeDirection", "orderTradeFillAuthority", "cashFeePositionMutation", "brokerWrite", "productionWrite"], label: "portfolio lab quant authority", errors: &errors)
    annualPortfolioLabObject(evidence["safety"], keys: ["sendsLiveNetworkRequests", "writesDatabase", "callsBroker", "createsOrder", "createsTrade", "mutatesOfficialPortfolio"], label: "portfolio lab quant safety", errors: &errors)
    if let evidenceId = evidence["evidenceId"] as? String {
        do {
            let expected = try portfolioDecisionContentId(object: evidence, prefix: "annual-portfolio-lab-quant:", excludingTopLevelKeys: ["evidenceId"])
            if evidenceId != expected { errors.append("portfolio lab quant evidenceId does not match canonical content") }
        } catch { errors.append("portfolio lab quant evidence identity cannot be recomputed") }
    }
}

private func annualPortfolioLabObject(
    _ value: Any?,
    keys: [String],
    optional: Set<String> = [],
    label: String,
    errors: inout [String]
) {
    guard let value = value as? [String: Any] else {
        errors.append("\(label) must be an object")
        return
    }
    annualPortfolioLabExact(value, keys: keys, optional: optional, label: label, errors: &errors)
}

private func annualPortfolioLabArrayObjects(
    _ value: Any?,
    keys: [String],
    label: String,
    errors: inout [String],
    nested: (([String: Any], Int, inout [String]) -> Void)? = nil
) {
    guard let values = value as? [[String: Any]] else {
        errors.append("\(label) must be an array of objects")
        return
    }
    for (index, item) in values.enumerated() {
        annualPortfolioLabExact(item, keys: keys, label: "\(label) \(index)", errors: &errors)
        nested?(item, index, &errors)
    }
}

private func annualPortfolioLabExact(
    _ value: [String: Any],
    keys: [String],
    optional: Set<String> = [],
    label: String,
    errors: inout [String]
) {
    let allowed = Set(keys)
    for key in value.keys where !allowed.contains(key) {
        errors.append("\(label) contains unsupported field \(key)")
    }
    for key in keys where !optional.contains(key) && value[key] == nil {
        errors.append("\(label) is missing field \(key)")
    }
}
