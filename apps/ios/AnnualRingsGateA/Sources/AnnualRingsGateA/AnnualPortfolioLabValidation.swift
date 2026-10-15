import Foundation

extension AnnualPortfolioLabEnvelope {
    public func validated(
        expectedMembershipId: String,
        expectedMembershipVersion: Int,
        expectedSymbol: String,
        expectedAmounts: [Double]
    ) throws -> Self {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 || calculationVersion != Self.calculationVersionV1 {
            errors.append("portfolio lab contract version is invalid")
        }
        if !isStrictUtcDateTime(generatedAt) {
            errors.append("portfolio lab generatedAt must be an ISO UTC instant")
        }
        if !["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].contains(status) {
            errors.append("portfolio lab status is invalid")
        }
        if membershipId != expectedMembershipId {
            errors.append("portfolio lab membershipId changed during the request")
        }
        if requestedActorId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || gaps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("portfolio lab actor, message, and gaps must remain explicit")
        }
        safety.validate(errors: &errors)
        if status == "available" {
            guard let data, let requestedSymbol, let labId else {
                errors.append("available portfolio lab requires data and identities")
                throw AnnualPortfolioLabValidationError.invalid(errors)
            }
            if requestedSymbol != expectedSymbol || labId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                errors.append("available portfolio lab must bind the expected symbol and content identity")
            }
            try data.validate(
                envelopeMembershipId: membershipId,
                expectedMembershipVersion: expectedMembershipVersion,
                expectedSymbol: expectedSymbol,
                expectedAmounts: expectedAmounts,
                errors: &errors
            )
        } else if labId != nil || requestedSymbol != nil || data != nil {
            errors.append("non-available portfolio lab must clear labId, requestedSymbol, and data")
        }
        if !errors.isEmpty {
            throw AnnualPortfolioLabValidationError.invalid(errors)
        }
        return self
    }
}

private extension AnnualPortfolioLabSafety {
    func validate(errors: inout [String]) {
        if !advisoryOnly || !userProvidedAmountsOnly || !preservesScenarioOrder
            || changesCandidateOrdering || recommendation || ranking || score || suggestedAmount
            || targetWeight || targetPrice || tradeDirection || createsOrder || createsTrade
            || callsBroker || mutatesOfficialPortfolio || productionWrite {
            errors.append("portfolio lab safety must remain ordered user-input advisory only")
        }
    }
}

private extension AnnualPortfolioLabData {
    func validate(
        envelopeMembershipId: String,
        expectedMembershipVersion: Int,
        expectedSymbol: String,
        expectedAmounts: [Double],
        errors: inout [String]
    ) throws {
        if target.membershipId != envelopeMembershipId || target.membershipVersion != expectedMembershipVersion
            || target.symbol != expectedSymbol || target.market != "HK" || target.symbol != "HK.\(target.code)"
            || !["tracked", "paused"].contains(target.membershipState) {
            errors.append("portfolio lab target does not bind the current candidate membership")
        }
        try portfolio.validateForDisplay()
        if ![.available, .stale].contains(portfolio.status) || portfolio.contextId != sourceIdentity.portfolioContextId
            || portfolio.portfolioSnapshotId != sourceIdentity.portfolioSnapshotId
            || portfolio.accountScopeId != sourceIdentity.accountScopeId
            || portfolio.portfolioAsOf != sourceIdentity.portfolioAsOf {
            errors.append("portfolio lab source identity does not bind the exact available current portfolio")
        }
        sourceIdentity.validate(expectedSymbol: expectedSymbol, errors: &errors)
        dimensions.validate(portfolio: portfolio, expectedSymbol: expectedSymbol, errors: &errors)
        current.validate(portfolio: portfolio, candidateSymbol: expectedSymbol, errors: &errors)
        let evidence = try quant.validate(portfolio: portfolio, candidateSymbol: expectedSymbol, errors: &errors)
        if scenarios.count != expectedAmounts.count || scenarios.isEmpty || scenarios.count > 4 {
            errors.append("portfolio lab scenario count must match one to four user amounts")
        }
        for (index, scenario) in scenarios.enumerated() {
            let amount = expectedAmounts.indices.contains(index) ? expectedAmounts[index] : .nan
            try scenario.validate(
                sourceIndex: index,
                expectedAmount: amount,
                portfolio: portfolio,
                current: current,
                candidateSymbol: expectedSymbol,
                evidence: quant.coverage.status == "exact" ? evidence : nil,
                errors: &errors
            )
        }
        if quant.coverage.status == "exact", let evidence {
            let weights = Dictionary(uniqueKeysWithValues: portfolio.positions.map { ($0.symbol, $0.marketWeight ?? 0) })
            let expected = annualPortfolioLabHistoricalMetrics(evidence: evidence, weights: weights, candidateSymbol: expectedSymbol)
            if current.historical != expected {
                errors.append("current historical metrics do not recompute from exact evidence and current weights")
            }
        }
    }
}

private extension AnnualPortfolioLabSourceIdentity {
    func validate(expectedSymbol: String, errors: inout [String]) {
        for value in [accountScopeId, portfolioContextId, portfolioSnapshotId, decisionContextId, decisionContextHash, quote.snapshotId, quote.source] where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab source identities must be non-empty")
        }
        if !isStrictUtcDateTime(portfolioAsOf) || quote.symbol != expectedSymbol || quote.currency != "HKD"
            || quote.source != "futu"
            || !quote.price.isFinite || quote.price <= 0 || !isStrictUtcDateTime(quote.quoteTime)
            || !isStrictUtcDateTime(quote.fetchedAt) {
            errors.append("portfolio lab quote and portfolio time identities are invalid")
        }
    }
}

private extension AnnualPortfolioLabDimensions {
    func validate(portfolio: PortfolioDecisionContextEnvelope, expectedSymbol: String, errors: inout [String]) {
        if positions.count != portfolio.positions.count {
            errors.append("portfolio lab dimensions must cover current positions")
        }
        for (index, item) in positions.enumerated() where portfolio.positions.indices.contains(index) {
            let position = portfolio.positions[index]
            if item.sourceIndex != index || item.symbol != position.symbol || item.name != position.name
                || item.currency != "HKD" || item.marketValue != position.marketValue
                || item.marketWeight != position.marketWeight {
                errors.append("portfolio lab position dimensions must preserve portfolio source order")
            }
            item.sector.validate(label: "position sector", errors: &errors)
        }
        if candidate.symbol != expectedSymbol || candidate.currency != "HKD"
            || candidate.currentlyHeld != portfolio.positions.contains(where: { $0.symbol == expectedSymbol }) {
            errors.append("portfolio lab candidate dimension does not bind current holdings")
        }
        candidate.sector.validate(label: "candidate sector", errors: &errors)
        if currency.status != "single_currency" || currency.currencies != ["HKD"]
            || currency.marketValueByCurrency.count != 1
            || currency.marketValueByCurrency.first?.currency != "HKD"
            || currency.marketValueByCurrency.first?.marketValue != portfolio.summary.marketValue.amount
            || currency.marketValueByCurrency.first?.weight != 1 {
            errors.append("portfolio lab currency dimension must bind one complete HKD portfolio")
        }
    }
}

private extension AnnualPortfolioLabSectorGap {
    func validate(label: String, errors: inout [String]) {
        if status != "not_captured" || value != nil || limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) must remain an explicit not_captured gap")
        }
    }
}

private extension AnnualPortfolioLabCurrent {
    func validate(portfolio: PortfolioDecisionContextEnvelope, candidateSymbol: String, errors: inout [String]) {
        let held = portfolio.positions.first(where: { $0.symbol == candidateSymbol })
        if totalMarketValue != portfolio.summary.marketValue.amount
            || candidateMarketValue != (held?.marketValue ?? 0)
            || candidateWeight != (held?.marketWeight ?? 0)
            || largestPositionWeight != portfolio.summary.concentration.largestPositionWeight
            || hhi != portfolio.summary.concentration.hhi {
            errors.append("portfolio lab current baseline does not bind current portfolio calculations")
        }
        historical.validate(label: "current historical", errors: &errors)
    }
}

private extension AnnualPortfolioLabScenario {
    func validate(
        sourceIndex expectedIndex: Int,
        expectedAmount: Double,
        portfolio: PortfolioDecisionContextEnvelope,
        current: AnnualPortfolioLabCurrent,
        candidateSymbol: String,
        evidence: AnnualPortfolioLabQuantEvidence?,
        errors: inout [String]
    ) throws {
        if sourceIndex != expectedIndex || hypotheticalAmount != expectedAmount
            || !hypotheticalAmount.isFinite || hypotheticalAmount < 0
            || scenarioId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab scenario must preserve user amount source order")
        }
        try validatePortfolioRiskImpactBinding(
            impact: riskImpact,
            context: portfolio,
            candidateSymbol: candidateSymbol,
            hypotheticalAmount: hypotheticalAmount, allowStaleReadOnly: true
        )
        comparison.validate(
            portfolio: portfolio,
            risk: riskImpact,
            current: current,
            candidateSymbol: candidateSymbol,
            errors: &errors
        )
        historical.validate(label: "scenario historical", errors: &errors)
        if let evidence {
            let total = riskImpact.scenario.totalMarketValue ?? 1
            var weights = Dictionary(uniqueKeysWithValues: portfolio.positions
                .filter { $0.symbol != candidateSymbol }
                .map { ($0.symbol, portfolioDecisionJSRound(($0.marketValue ?? 0) / total, digits: 8)) })
            weights[candidateSymbol] = riskImpact.scenario.candidateWeight ?? 0
            let expected = annualPortfolioLabHistoricalMetrics(evidence: evidence, weights: weights, candidateSymbol: candidateSymbol)
            if historical.base != expected
                || historical.annualizedVolatilityChange != annualPortfolioLabDifference(expected.annualizedVolatility, current.historical.annualizedVolatility)
                || historical.historicalStressLossChange != annualPortfolioLabDifference(expected.historicalStressLossMagnitude, current.historical.historicalStressLossMagnitude)
                || historical.historicalTailLossChange != annualPortfolioLabDifference(expected.historicalTailLossMagnitude, current.historical.historicalTailLossMagnitude)
                || historical.candidateRiskContributionChange != annualPortfolioLabDifference(expected.candidateRiskContribution, current.historical.candidateRiskContribution) {
                errors.append("portfolio lab scenario historical metrics do not recompute from exact evidence and scenario weights")
            }
        } else if [
            historical.annualizedVolatilityChange,
            historical.historicalStressLossChange,
            historical.historicalTailLossChange,
            historical.candidateRiskContributionChange
        ].contains(where: { $0 != nil }) {
            errors.append("non-available scenario historical changes must be cleared")
        }
    }
}

private extension AnnualPortfolioLabScenarioComparison {
    func validate(
        portfolio: PortfolioDecisionContextEnvelope,
        risk: PortfolioRiskImpactEnvelope,
        current: AnnualPortfolioLabCurrent,
        candidateSymbol: String,
        errors: inout [String]
    ) {
        if candidateWeightChange != risk.scenario.weightChange
            || largestPositionWeightChange != portfolioDecisionJSRound((risk.scenario.largestPositionWeight ?? 0) - current.largestPositionWeight, digits: 8)
            || hhiChange != portfolioDecisionJSRound((risk.scenario.hhi ?? 0) - current.hhi, digits: 8) {
            errors.append("portfolio lab scenario concentration deltas do not recompute")
        }
        let total = risk.scenario.totalMarketValue ?? 1
        let expected = portfolio.positions.filter { $0.symbol != candidateSymbol }.map { position in
            let scenarioWeight = portfolioDecisionJSRound((position.marketValue ?? 0) / total, digits: 8)
            return AnnualPortfolioLabPositionWeightChange(
                symbol: position.symbol,
                currentWeight: position.marketWeight ?? 0,
                scenarioWeight: scenarioWeight,
                weightChange: portfolioDecisionJSRound(scenarioWeight - (position.marketWeight ?? 0), digits: 8)
            )
        }
        if otherPositionWeightChanges != expected || fundingSourceStatus != "not_captured"
            || cashStatus != "unknown" || opportunityCostLimitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab opportunity cost must preserve source order and keep funding and cash unknown")
        }
    }
}

private extension AnnualPortfolioHistoricalMetrics {
    func validate(label: String, errors: inout [String]) {
        if !["available", "not_captured", "unavailable"].contains(status)
            || limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(label) status and limitation are invalid")
        }
        for value in [annualizedVolatility, historicalStressLossMagnitude, historicalTailLossMagnitude, candidateRiskContribution] where value.map({ !$0.isFinite }) == true {
            errors.append("\(label) metrics must be finite when present")
        }
        if let historicalStressDate, !annualPortfolioLabStrictDate(historicalStressDate) {
            errors.append("\(label) stress date is invalid")
        }
        if status != "available" && [annualizedVolatility, historicalStressLossMagnitude, historicalTailLossMagnitude, candidateRiskContribution].contains(where: { $0 != nil }) {
            errors.append("\(label) non-available metrics must be cleared")
        }
    }
}

private extension AnnualPortfolioLabScenarioHistorical {
    func validate(label: String, errors: inout [String]) {
        base.validate(label: label, errors: &errors)
        for value in [annualizedVolatilityChange, historicalStressLossChange, historicalTailLossChange, candidateRiskContributionChange] where value.map({ !$0.isFinite }) == true {
            errors.append("\(label) changes must be finite when present")
        }
    }
}

private extension AnnualPortfolioLabQuantView {
    func validate(
        portfolio: PortfolioDecisionContextEnvelope,
        candidateSymbol: String,
        errors: inout [String]
    ) throws -> AnnualPortfolioLabQuantEvidence? {
        if !["available", "missing", "malformed", "unavailable"].contains(evidenceStatus) {
            errors.append("portfolio lab quant evidenceStatus is invalid")
        }
        if evidenceStatus == "available" && evidence == nil || evidenceStatus != "available" && evidence != nil {
            errors.append("portfolio lab quant evidence availability does not match status")
        }
        if let evidence {
            try evidence.validate(errors: &errors)
        }
        var requiredSymbols: [String] = []
        for symbol in portfolio.positions.map(\.symbol) + [candidateSymbol] where !requiredSymbols.contains(symbol) {
            requiredSymbols.append(symbol)
        }
        let universe = evidence?.source.universe.map(\.symbol) ?? []
        let covered = requiredSymbols.filter(universe.contains)
        let missing = requiredSymbols.filter { !universe.contains($0) }
        let extra = universe.filter { !requiredSymbols.contains($0) }
        let expectedCoverage = evidence == nil ? "unavailable" : missing.isEmpty ? "exact" : "incomplete"
        if coverage.status != expectedCoverage || coverage.requiredSymbols != requiredSymbols
            || coverage.coveredSymbols != covered || coverage.missingSymbols != missing
            || coverage.extraEvidenceSymbols != extra {
            errors.append("portfolio lab quant coverage does not derive from exact current positions and candidate")
        }
        correlations.validate(
            coverageStatus: expectedCoverage,
            evidence: evidence,
            portfolio: portfolio,
            candidateSymbol: candidateSymbol,
            errors: &errors
        )
        candidateLiquidity.validate(evidence: evidence, candidateSymbol: candidateSymbol, errors: &errors)
        if limitations.isEmpty || limitations.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("portfolio lab quant limitations must remain explicit")
        }
        return evidence
    }
}

private extension AnnualPortfolioLabQuantEvidence {
    func validate(errors: inout [String]) throws {
        if schemaVersion != Self.schemaVersionV1 || !isStrictUtcDateTime(generatedAt) {
            errors.append("portfolio lab quant evidence version or generatedAt is invalid")
        }
        if feePolicyVersion != Self.requiredFeePolicyVersion || feePolicySha256 != Self.requiredFeePolicySha256 {
            errors.append("portfolio lab quant fee policy identity is invalid")
        }
        if executionCalendar.timing != "next_observed_session_open"
            || executionCalendar.calendarCompleteness != "unknown" {
            errors.append("portfolio lab quant execution calendar is invalid")
        }
        try source.validate(errors: &errors)
        method.validate(errors: &errors)
        stability.validate(method: method, errors: &errors)
        try validateDailyReturns(errors: &errors)
        try validateSeries(errors: &errors)
        try validateCovariance(errors: &errors)
        executionEvidence.validate(source: source, errors: &errors)
        codeIdentity.validate(errors: &errors)
        authority.validate(errors: &errors)
        safety.validate(errors: &errors)
        if limitations.isEmpty || evidenceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab quant evidence limitations and identity are required")
        }
    }

    func validateDailyReturns(errors: inout [String]) throws {
        if dailyReturns.count != method.observationCount || method.commonTradingDates.count != dailyReturns.count {
            errors.append("portfolio lab quant returns must match observationCount")
        }
        for (rowIndex, row) in dailyReturns.enumerated() {
            if !method.commonTradingDates.indices.contains(rowIndex) || row.tradeDate != method.commonTradingDates[rowIndex]
                || row.values.count != source.universe.count {
                errors.append("portfolio lab quant returns must preserve date and universe order")
                continue
            }
            for (symbolIndex, item) in row.values.enumerated() where source.universe.indices.contains(symbolIndex) {
                if item.symbol != source.universe[symbolIndex].symbol || !item.previousClose.isFinite
                    || item.previousClose <= 0 || !item.close.isFinite || item.close <= 0
                    || !item.volume.isFinite || item.volume < 0 || !item.turnover.isFinite || item.turnover < 0
                    || item.value != portfolioDecisionJSRound(item.close / item.previousClose - 1, digits: 10) {
                    errors.append("portfolio lab quant return values do not recompute from source-order closes")
                }
            }
        }
    }

    func validateSeries(errors: inout [String]) throws {
        if series.count != source.universe.count {
            errors.append("portfolio lab quant series must cover the universe")
        }
        for (index, item) in series.enumerated() where source.universe.indices.contains(index) {
            let universe = source.universe[index]
            let observations = dailyReturns.compactMap { $0.values.first(where: { $0.symbol == universe.symbol }) }
            let returns = observations.map(\.value)
            if item.symbol != universe.symbol || item.boardLot != universe.boardLot
                || item.annualizedVolatility != portfolioDecisionJSRound(annualPortfolioLabStandardDeviation(returns) * sqrt(Double(method.annualizationDays)), digits: 10)
                || item.worstDailyReturn != portfolioDecisionJSRound(returns.min() ?? 0, digits: 10)
                || item.historicalTailLossMagnitude != portfolioDecisionJSRound(annualPortfolioLabTailLoss(returns, confidence: method.tailConfidence), digits: 10) {
                errors.append("portfolio lab quant series metrics do not recompute")
            }
            let volumes = observations.map(\.volume)
            let turnovers = observations.map(\.turnover)
            if item.liquidity.medianDailyVolume != portfolioDecisionJSRound(annualPortfolioLabMedian(volumes), digits: 4)
                || item.liquidity.medianDailyTurnover != portfolioDecisionJSRound(annualPortfolioLabMedian(turnovers), digits: 4)
                || item.liquidity.minimumDailyVolume != portfolioDecisionJSRound(volumes.min() ?? 0, digits: 4)
                || item.liquidity.minimumDailyTurnover != portfolioDecisionJSRound(turnovers.min() ?? 0, digits: 4)
                || item.liquidity.zeroVolumeObservationCount != volumes.filter({ $0 == 0 }).count {
                errors.append("portfolio lab quant liquidity metrics do not recompute")
            }
        }
    }

    func validateCovariance(errors: inout [String]) throws {
        if covariance.count != source.universe.count * (source.universe.count + 1) / 2 {
            errors.append("portfolio lab quant covariance upper triangle is incomplete")
        }
        var sourceIndex = 0
        for leftIndex in source.universe.indices {
            for rightIndex in leftIndex..<source.universe.count {
                guard covariance.indices.contains(sourceIndex) else { continue }
                let item = covariance[sourceIndex]
                sourceIndex += 1
                let leftSymbol = source.universe[leftIndex].symbol
                let rightSymbol = source.universe[rightIndex].symbol
                let left = dailyReturns.compactMap { $0.values.first(where: { $0.symbol == leftSymbol })?.value }
                let right = dailyReturns.compactMap { $0.values.first(where: { $0.symbol == rightSymbol })?.value }
                let dailyCovariance = annualPortfolioLabCovariance(left, right)
                let denominator = annualPortfolioLabStandardDeviation(left) * annualPortfolioLabStandardDeviation(right)
                let expectedCorrelation = denominator == 0 ? nil : portfolioDecisionJSRound(dailyCovariance / denominator, digits: 10)
                if item.leftSymbol != leftSymbol || item.rightSymbol != rightSymbol
                    || item.annualizedCovariance != portfolioDecisionJSRound(dailyCovariance * Double(method.annualizationDays), digits: 12)
                    || item.correlation != expectedCorrelation {
                    errors.append("portfolio lab quant covariance does not recompute in source order")
                }
            }
        }
    }
}

private extension AnnualPortfolioLabQuantSource {
    func validate(errors: inout [String]) throws {
        if snapshotId.isEmpty || snapshotHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || dataHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || !["fixture", "fixture_market_data_export", "approved_real_historical"].contains(sourceClassification)
            || !["none", "forward", "backward"].contains(adjustment)
            || !isStrictUtcDateTime(dataCutoff) || !annualPortfolioLabStrictDate(observationStartDate)
            || !annualPortfolioLabStrictDate(observationEndDate) || universe.count < 2 {
            errors.append("portfolio lab quant source identity is invalid")
        }
        var seen = Set<String>()
        for item in universe {
            if item.market != "HK" || item.symbol != "HK.\(item.code)" || item.boardLot <= 0 || !seen.insert(item.symbol).inserted {
                errors.append("portfolio lab quant universe identity is invalid or duplicated")
            }
        }
        if let hkConnectUniverse, !hkConnectUniverse.isValidOfficialHongKongConnectBinding {
            errors.append("portfolio lab official Hong Kong Connect universe binding is invalid")
        }
        if sourceIdentity.authority != "research_only" || !isStrictUtcDateTime(sourceIdentity.asOf)
            || !isStrictUtcDateTime(sourceIdentity.fetchedAt) || sourceIdentity.sourceHash.isEmpty {
            errors.append("portfolio lab quant source authority or timestamps are invalid")
        }
    }
}

private extension AnnualPortfolioLabQuantMethod {
    func validate(errors: inout [String]) {
        if returnMethod != "close_to_close_simple" || covarianceEstimator != "sample_n_minus_1"
            || observationAlignment != "exact_common_trading_dates" || annualizationDays <= 0
            || annualizationDays > 366 || tailConfidence < 0.5 || tailConfidence >= 1
            || observationCount < 2 || commonTradingDates.count != observationCount
            || commonTradingDates.contains(where: { !annualPortfolioLabStrictDate($0) }) {
            errors.append("portfolio lab quant method is invalid")
        }
    }
}

private extension AnnualPortfolioLabQuantStability {
    func validate(method: AnnualPortfolioLabQuantMethod, errors: inout [String]) {
        let expected = observationCount >= minimumStableObservationCount ? "sample_threshold_met" : "insufficient_tiny_sample"
        if observationCount != method.observationCount || minimumStableObservationCount < 2
            || status != expected || limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab quant stability does not derive from the observation threshold")
        }
    }
}

private extension AnnualPortfolioLabExecutionEvidence {
    func validate(source: AnnualPortfolioLabQuantSource, errors: inout [String]) {
        if boardLots != source.universe.map({ .init(symbol: $0.symbol, boardLot: $0.boardLot) })
            || feeCurrency != "HKD" || signalTiming != "after_close_t"
            || earliestExecution != "next_trading_day_open" || allowsSameBarExecution || allowsMargin
            || fees.values.contains(where: { !$0.isFinite || $0 < 0 })
            || nonZeroCosts != fees.values.contains(where: { $0 > 0 }) {
            errors.append("portfolio lab execution evidence violates T+1, board-lot, or non-zero-cost boundaries")
        }
    }
}

private extension AnnualPortfolioLabFees {
    var values: [Double] { [commissionRate, minCommission, platformFee, stampDutyRate, tradingFeeRate, transactionLevyRate] }
}

private extension AnnualPortfolioLabCodeIdentity {
    func validate(errors: inout [String]) {
        if scriptPath.isEmpty || configPath.isEmpty
            || scriptHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || configHash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("portfolio lab quant code identity is invalid")
        }
    }
}

private extension AnnualPortfolioLabQuantAuthority {
    func validate(errors: inout [String]) {
        if !researchOnly || !advisoryOnly || currentPortfolioFact || brokerReconciliation
            || accountingAuthority || recommendation || ranking || score || allocation || sizing
            || targetPrice || tradeDirection || orderTradeFillAuthority || cashFeePositionMutation
            || brokerWrite || productionWrite {
            errors.append("portfolio lab quant authority is unsafe")
        }
    }
}

private extension AnnualPortfolioLabQuantSafety {
    func validate(errors: inout [String]) {
        if sendsLiveNetworkRequests || writesDatabase || callsBroker || createsOrder
            || createsTrade || mutatesOfficialPortfolio {
            errors.append("portfolio lab quant safety is unsafe")
        }
    }
}

private extension AnnualPortfolioLabCorrelations {
    func validate(
        coverageStatus: String,
        evidence: AnnualPortfolioLabQuantEvidence?,
        portfolio: PortfolioDecisionContextEnvelope,
        candidateSymbol: String,
        errors: inout [String]
    ) {
        if coverageStatus == "exact", let evidence {
            let expected = portfolio.positions.filter { $0.symbol != candidateSymbol }.map { position in
                AnnualPortfolioLabCorrelation(
                    symbol: position.symbol,
                    correlation: evidence.correlation(left: candidateSymbol, right: position.symbol)
                )
            }
            if status != "available" || observationStartDate != evidence.source.observationStartDate
                || observationEndDate != evidence.source.observationEndDate
                || observationCount != evidence.method.observationCount || stability != evidence.stability.status
                || candidateToPositions != expected {
                errors.append("portfolio lab correlations do not bind exact evidence and position source order")
            }
        } else if status != (evidence == nil ? "unavailable" : "not_captured")
            || observationStartDate != nil || observationEndDate != nil || observationCount != nil
            || stability != "unavailable" || !candidateToPositions.isEmpty {
            errors.append("non-available portfolio lab correlations must clear every metric")
        }
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab correlation limitation is required")
        }
    }
}

private extension AnnualPortfolioLabLiquidity {
    func validate(evidence: AnnualPortfolioLabQuantEvidence?, candidateSymbol: String, errors: inout [String]) {
        let series = evidence?.series.first(where: { $0.symbol == candidateSymbol })
        if symbol != candidateSymbol || status != (series == nil ? evidence == nil ? "unavailable" : "not_captured" : "available") {
            errors.append("portfolio lab candidate liquidity status or symbol is invalid")
        }
        if let series, let evidence {
            if observationCount != evidence.method.observationCount
                || medianDailyVolume != series.liquidity.medianDailyVolume
                || medianDailyTurnover != series.liquidity.medianDailyTurnover
                || minimumDailyVolume != series.liquidity.minimumDailyVolume
                || minimumDailyTurnover != series.liquidity.minimumDailyTurnover
                || zeroVolumeObservationCount != series.liquidity.zeroVolumeObservationCount
                || boardLot != series.boardLot || feeCurrency != evidence.executionEvidence.feeCurrency
                || nonZeroCosts != evidence.executionEvidence.nonZeroCosts || fees != evidence.executionEvidence.fees {
                errors.append("portfolio lab candidate liquidity does not bind exact evidence")
            }
        } else if observationCount != nil || medianDailyVolume != nil || medianDailyTurnover != nil
            || minimumDailyVolume != nil || minimumDailyTurnover != nil || zeroVolumeObservationCount != nil
            || boardLot != nil || feeCurrency != nil || nonZeroCosts != nil || fees != nil {
            errors.append("non-available portfolio lab liquidity must clear every metric")
        }
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("portfolio lab liquidity limitation is required")
        }
    }
}

private extension AnnualPortfolioLabQuantEvidence {
    func correlation(left: String, right: String) -> Double? {
        covariance.first(where: {
            $0.leftSymbol == left && $0.rightSymbol == right
                || $0.leftSymbol == right && $0.rightSymbol == left
        })?.correlation
    }
}

func annualPortfolioLabHistoricalMetrics(
    evidence: AnnualPortfolioLabQuantEvidence,
    weights: [String: Double],
    candidateSymbol: String
) -> AnnualPortfolioHistoricalMetrics {
    let rows = evidence.dailyReturns.map { row in
        (date: row.tradeDate, value: row.values.reduce(0) { $0 + (weights[$1.symbol] ?? 0) * $1.value })
    }
    let values = rows.map(\.value)
    let worst = rows.sorted { $0.value == $1.value ? $0.date < $1.date : $0.value < $1.value }.first!
    return .init(
        status: "available",
        annualizedVolatility: portfolioDecisionJSRound(annualPortfolioLabStandardDeviation(values) * sqrt(Double(evidence.method.annualizationDays)), digits: 10),
        historicalStressLossMagnitude: portfolioDecisionJSRound(max(0, -worst.value), digits: 10),
        historicalStressDate: worst.date,
        historicalTailLossMagnitude: portfolioDecisionJSRound(annualPortfolioLabTailLoss(values, confidence: evidence.method.tailConfidence), digits: 10),
        candidateRiskContribution: annualPortfolioLabRiskContribution(evidence: evidence, weights: weights, candidateSymbol: candidateSymbol),
        limitation: "Historical metrics use the exact canonical quant window and current fact weights as research evidence only."
    )
}

private func annualPortfolioLabRiskContribution(
    evidence: AnnualPortfolioLabQuantEvidence,
    weights: [String: Double],
    candidateSymbol: String
) -> Double? {
    let symbols = evidence.source.universe.map(\.symbol)
    guard let candidateIndex = symbols.firstIndex(of: candidateSymbol) else { return nil }
    let vector = symbols.map { weights[$0] ?? 0 }
    let marginal = symbols.map { left in
        symbols.enumerated().reduce(0) { total, item in
            total + annualPortfolioLabCovariance(evidence: evidence, left: left, right: item.element) * vector[item.offset]
        }
    }
    let variance = vector.enumerated().reduce(0) { $0 + $1.element * marginal[$1.offset] }
    guard variance > 0 else { return nil }
    return portfolioDecisionJSRound(vector[candidateIndex] * marginal[candidateIndex] / variance, digits: 10)
}

private func annualPortfolioLabCovariance(
    evidence: AnnualPortfolioLabQuantEvidence,
    left: String,
    right: String
) -> Double {
    evidence.covariance.first(where: {
        $0.leftSymbol == left && $0.rightSymbol == right
            || $0.leftSymbol == right && $0.rightSymbol == left
    })?.annualizedCovariance ?? 0
}

private func annualPortfolioLabDifference(_ left: Double?, _ right: Double?) -> Double? {
    guard let left, let right else { return nil }
    return portfolioDecisionJSRound(left - right, digits: 10)
}

private func annualPortfolioLabTailLoss(_ values: [Double], confidence: Double) -> Double {
    let count = max(1, Int(ceil(Double(values.count) * (1 - confidence))))
    return max(0, -annualPortfolioLabMean(Array(values.sorted().prefix(count))))
}

private func annualPortfolioLabStandardDeviation(_ values: [Double]) -> Double {
    sqrt(annualPortfolioLabCovariance(values, values))
}

private func annualPortfolioLabCovariance(_ left: [Double], _ right: [Double]) -> Double {
    let leftMean = annualPortfolioLabMean(left)
    let rightMean = annualPortfolioLabMean(right)
    return left.enumerated().reduce(0) { $0 + ($1.element - leftMean) * (right[$1.offset] - rightMean) }
        / Double(left.count - 1)
}

private func annualPortfolioLabMedian(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    let middle = sorted.count / 2
    return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

private func annualPortfolioLabMean(_ values: [Double]) -> Double {
    values.reduce(0, +) / Double(values.count)
}

private func annualPortfolioLabStrictDate(_ value: String) -> Bool {
    value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
        && (try? Date.ISO8601FormatStyle().parse("\(value)T00:00:00Z")) != nil
}
