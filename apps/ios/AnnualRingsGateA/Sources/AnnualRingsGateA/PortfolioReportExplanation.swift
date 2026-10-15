import Foundation

public let portfolioReportExplanationSchemaVersion =
    "2026-08-19.portfolio-report-explanation.v2"

public enum PortfolioReportExplanationStatus: String, Codable, Equatable, Sendable {
    case available, blocked
    case notFound = "not_found"
    case malformed, unauthorized, unavailable
}

public enum PortfolioReportExplanationValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct PortfolioReportExplanationEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let generatedAt: String
    public let status: PortfolioReportExplanationStatus
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let data: PortfolioReportExplanationData?
    public let gaps: [String]
    public let safety: PortfolioReportExplanationSafety
    public let message: String

    public func validated(
        expectedMembershipId: String,
        expectedMembershipVersion: Int,
        expectedMembershipState: CandidateMembershipState,
        expectedActorId: String,
        expectedSymbol: String,
        expectedAmounts: [Double]
    ) throws -> Self {
        var errors: [String] = []
        if schemaVersion != portfolioReportExplanationSchemaVersion {
            errors.append("schemaVersion is invalid")
        }
        if !isStrictUtcDateTime(generatedAt) { errors.append("generatedAt is invalid") }
        if membershipId != expectedMembershipId || !portfolioReportPositiveId(membershipId) {
            errors.append("membershipId is invalid")
        }
        if requestedActorId != expectedActorId || requestedActorId.isEmpty || message.isEmpty
            || gaps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("message, actor, and gaps must be safe strings")
        }
        safety.validate(errors: &errors)
        if status == .available, let data {
            if requestedSymbol != expectedSymbol { errors.append("requestedSymbol is invalid") }
            data.validate(
                membershipId: expectedMembershipId,
                membershipVersion: expectedMembershipVersion,
                membershipState: expectedMembershipState,
                symbol: expectedSymbol,
                actorId: requestedActorId,
                amounts: expectedAmounts,
                errors: &errors
            )
        } else if status == .available {
            errors.append("available response requires data")
        } else if data != nil || requestedSymbol != nil {
            errors.append("non-available response must clear facts")
        }
        guard errors.isEmpty else {
            throw PortfolioReportExplanationValidationError.invalid(errors)
        }
        return self
    }
}

public struct PortfolioReportExplanationData: Codable, Equatable, Sendable {
    public let binding: PortfolioReportExplanationBinding
    public let holdings: PortfolioReportExplanationHoldings
    public let scenarios: [PortfolioReportExplanationScenario]
    public let quantRisk: PortfolioReportExplanationQuantRisk
    public let unknowns: PortfolioReportExplanationUnknowns
}

public struct PortfolioReportExplanationBinding: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let membershipState: CandidateMembershipState
    public let symbol: String
    public let evidencePackId: String
    public let evidencePackVersion: Int
    public let evidencePackFingerprint: String
    public let evidencePackActorId: String
    public let evidencePackMembershipId: String
    public let evidencePackMembershipVersion: Int
    public let evidencePackSymbol: String
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let reportEvidencePackId: String
    public let accountScopeId: String
    public let portfolioContextId: String
    public let portfolioSnapshotId: String
    public let portfolioAsOf: String
    public let decisionContextId: String
    public let decisionContextHash: String
    public let quote: PortfolioReportExplanationQuote
}

public struct PortfolioReportExplanationQuote: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let symbol: String
    public let currency: String
    public let price: Double
    public let quoteTime: String
    public let fetchedAt: String
    public let source: String
}

public enum PortfolioReportExplanationHoldingStatus: String, Codable, Equatable, Sendable {
    case held
    case notHeld = "not_held"
}

public struct PortfolioReportExplanationHoldings: Codable, Equatable, Sendable {
    public struct Candidate: Codable, Equatable, Sendable {
        public let status: PortfolioReportExplanationHoldingStatus
        public let marketValue: Double
        public let weight: Double
    }
    public struct Position: Codable, Equatable, Sendable {
        public let symbol: String
        public let name: String?
        public let marketValue: Double
        public let weight: Double
    }
    public struct Concentration: Codable, Equatable, Sendable {
        public let largestPositionWeight: Double
        public let topThreeWeight: Double
        public let hhi: Double
    }
    public let candidate: Candidate
    public let positions: [Position]
    public let totalMarketValue: Double
    public let concentration: Concentration
}

public struct PortfolioReportExplanationScenario: Codable, Equatable, Sendable {
    public let scenarioId: String
    public let userInputAmount: Double
    public let candidateWeight: Double
    public let candidateWeightChange: Double
    public let largestPositionWeight: Double
    public let largestPositionWeightChange: Double
    public let hhi: Double
    public let hhiChange: Double
}

public struct PortfolioReportExplanationQuantRisk: Codable, Equatable, Sendable {
    public struct Source: Codable, Equatable, Sendable {
        public let snapshotId: String
        public let snapshotHash: String
        public let dataHash: String
        public let dataCutoff: String
        public let observationStartDate: String
        public let observationEndDate: String
        public let fetchedAt: String
    }
    public struct Scenario: Codable, Equatable, Sendable {
        public let scenarioId: String
        public let historical: AnnualPortfolioLabScenarioHistorical
    }
    public let evidenceId: String
    public let hkConnectUniverse: CandidateDiscoveryUniverse
    public let source: Source
    public let coverage: AnnualPortfolioLabQuantCoverage
    public let correlations: AnnualPortfolioLabCorrelations
    public let candidateLiquidity: AnnualPortfolioLabLiquidity
    public let currentHistorical: AnnualPortfolioHistoricalMetrics
    public let scenarios: [Scenario]
    public let limitations: [String]
}

public struct PortfolioReportExplanationUnknowns: Codable, Equatable, Sendable {
    public let cash: String
    public let fundingSource: String
    public let sector: String
    public let opportunityCost: String
}

public struct PortfolioReportExplanationSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let readOnly: Bool
    public let recommendation: Bool
    public let ranking: Bool
    public let score: Bool
    public let suggestedAmount: Bool
    public let targetWeight: Bool
    public let targetPrice: Bool
    public let tradeDirection: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool
    public let reportWrite: Bool
    public let decisionWrite: Bool
    public let productionWrite: Bool
}

private extension PortfolioReportExplanationData {
    func validate(
        membershipId: String,
        membershipVersion: Int,
        membershipState: CandidateMembershipState,
        symbol: String,
        actorId: String,
        amounts: [Double],
        errors: inout [String]
    ) {
        binding.validate(
            membershipId: membershipId,
            membershipVersion: membershipVersion,
            membershipState: membershipState,
            symbol: symbol,
            actorId: actorId,
            errors: &errors
        )
        holdings.validate(symbol: symbol, errors: &errors)
        if !(1...4).contains(scenarios.count) || scenarios.map(\.userInputAmount) != amounts
            || Set(scenarios.map(\.scenarioId)).count != scenarios.count {
            errors.append("scenarios do not match requested amount order")
        }
        scenarios.forEach { $0.validate(holdings: holdings, errors: &errors) }
        quantRisk.validate(
            binding: binding,
            holdings: holdings,
            scenarios: scenarios,
            errors: &errors
        )
        if unknowns.cash != "UNKNOWN" || unknowns.fundingSource != "UNKNOWN"
            || unknowns.sector != "UNKNOWN" || unknowns.opportunityCost != "UNKNOWN" {
            errors.append("required unknowns were inferred")
        }
    }
}

private extension PortfolioReportExplanationQuantRisk {
    func validate(
        binding: PortfolioReportExplanationBinding,
        holdings: PortfolioReportExplanationHoldings,
        scenarios expectedScenarios: [PortfolioReportExplanationScenario],
        errors: inout [String]
    ) {
        let requiredSymbols = portfolioReportUnique(holdings.positions.map(\.symbol) + [binding.symbol])
        let correlationSymbols = holdings.positions.map(\.symbol).filter { $0 != binding.symbol }
        if evidenceId.range(of: #"^annual-portfolio-lab-quant:[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || !hkConnectUniverse.isValidOfficialHongKongConnectBinding
            || source.snapshotId.isEmpty || !portfolioReportSHA(source.snapshotHash)
            || !portfolioReportSHA(source.dataHash) || !isStrictUtcDateTime(source.dataCutoff)
            || !isStrictUtcDateTime(source.fetchedAt)
            || !portfolioReportDate(source.observationStartDate)
            || !portfolioReportDate(source.observationEndDate)
            || source.observationStartDate > source.observationEndDate {
            errors.append("versioned quant-risk identity is invalid")
        }
        if coverage.status != "exact" || coverage.requiredSymbols != requiredSymbols
            || coverage.coveredSymbols != requiredSymbols || !coverage.missingSymbols.isEmpty {
            errors.append("quant-risk coverage must be exact for current holdings and target")
        }
        if correlations.status != "available"
            || correlations.observationStartDate != source.observationStartDate
            || correlations.observationEndDate != source.observationEndDate
            || (correlations.observationCount ?? 0) <= 0
            || !["sample_threshold_met", "insufficient_tiny_sample"].contains(correlations.stability)
            || correlations.candidateToPositions.map(\.symbol) != correlationSymbols
            || correlations.candidateToPositions.contains(where: {
                $0.correlation.map { !$0.isFinite || abs($0) > 1 } ?? false
            }) || correlations.limitation.isEmpty {
            errors.append("quant-risk correlations are invalid")
        }
        if candidateLiquidity.status != "available" || candidateLiquidity.symbol != binding.symbol
            || (candidateLiquidity.observationCount ?? 0) <= 0
            || !portfolioReportNonnegative(candidateLiquidity.medianDailyTurnover ?? -Double.infinity)
            || (candidateLiquidity.boardLot ?? 0) <= 0 || candidateLiquidity.feeCurrency != "HKD"
            || candidateLiquidity.nonZeroCosts != true || candidateLiquidity.limitation.isEmpty {
            errors.append("quant-risk liquidity is invalid")
        }
        currentHistorical.validateQuantRisk(label: "current quant risk", errors: &errors)
        if scenarios.map(\.scenarioId) != expectedScenarios.map(\.scenarioId) {
            errors.append("quant-risk scenarios do not match user scenarios")
        }
        scenarios.forEach { $0.historical.validateQuantRisk(label: "scenario quant risk", errors: &errors) }
        if limitations.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            errors.append("quant-risk limitations are invalid")
        }
    }
}

private extension AnnualPortfolioHistoricalMetrics {
    func validateQuantRisk(label: String, errors: inout [String]) {
        if status != "available" || limitation.isEmpty || !portfolioReportDate(historicalStressDate ?? "")
            || [annualizedVolatility, historicalStressLossMagnitude, historicalTailLossMagnitude]
                .contains(where: { !portfolioReportNonnegative($0 ?? -Double.infinity) })
            || candidateRiskContribution?.isFinite != true {
            errors.append("\(label) is invalid")
        }
    }
}

private extension AnnualPortfolioLabScenarioHistorical {
    func validateQuantRisk(label: String, errors: inout [String]) {
        base.validateQuantRisk(label: label, errors: &errors)
        if [annualizedVolatilityChange, historicalStressLossChange, historicalTailLossChange, candidateRiskContributionChange]
            .contains(where: { $0?.isFinite != true }) {
            errors.append("\(label) changes are invalid")
        }
    }
}

private extension PortfolioReportExplanationBinding {
    func validate(
        membershipId expectedMembershipId: String,
        membershipVersion expectedMembershipVersion: Int,
        membershipState expectedMembershipState: CandidateMembershipState,
        symbol expectedSymbol: String,
        actorId: String,
        errors: inout [String]
    ) {
        if membershipId != expectedMembershipId || membershipVersion != expectedMembershipVersion
            || membershipState != expectedMembershipState || membershipState == .archived
            || symbol != expectedSymbol
            || evidencePackMembershipId != membershipId
            || evidencePackMembershipVersion != membershipVersion
            || evidencePackSymbol != symbol || evidencePackActorId != actorId
            || reportEvidencePackId != evidencePackId {
            errors.append("membership, actor, report, and pack bindings drifted")
        }
        if !portfolioReportPositiveId(evidencePackId) || evidencePackVersion <= 0
            || !portfolioReportSHA(evidencePackFingerprint) || !portfolioReportPositiveId(reportId)
            || reportVersion <= 0 || !portfolioReportSHA(reportFingerprint)
            || !portfolioReportSHA(decisionContextHash) {
            errors.append("report or pack identity is invalid")
        }
        if [accountScopeId, portfolioContextId, portfolioSnapshotId, decisionContextId]
            .contains(where: \.isEmpty)
            || !isStrictUtcDateTime(portfolioAsOf) {
            errors.append("portfolio identity is invalid")
        }
        if quote.snapshotId.isEmpty || quote.symbol != symbol || quote.currency != "HKD"
            || quote.source != "futu" || !portfolioReportNonnegative(quote.price) || quote.price == 0
            || !isStrictUtcDateTime(quote.quoteTime) || !isStrictUtcDateTime(quote.fetchedAt)
            || quote.quoteTime > quote.fetchedAt {
            errors.append("quote identity is invalid")
        }
    }
}

private extension PortfolioReportExplanationHoldings {
    func validate(symbol: String, errors: inout [String]) {
        let symbols = positions.map(\.symbol)
        if positions.isEmpty || Set(symbols).count != symbols.count || totalMarketValue <= 0
            || !portfolioReportNonnegative(totalMarketValue)
            || positions.contains(where: {
                SecuritySymbol.parseHongKongAlias($0.symbol)?.canonical != $0.symbol
                    || !portfolioReportNonnegative($0.marketValue)
                    || !portfolioReportWeight($0.weight)
            }) {
            errors.append("holdings are invalid")
        }
        if portfolioReportRound(positions.reduce(0) { $0 + $1.marketValue }, digits: 2) != totalMarketValue
            || positions.contains(where: {
                portfolioReportRound($0.marketValue / totalMarketValue) != $0.weight
            }) {
            errors.append("holdings do not recompute from market values")
        }
        let held = positions.first(where: { $0.symbol == symbol })
        if candidate.status != (held == nil ? .notHeld : .held)
            || candidate.marketValue != (held?.marketValue ?? 0)
            || candidate.weight != (held?.weight ?? 0) {
            errors.append("candidate holding does not match positions")
        }
        if !portfolioReportWeight(concentration.largestPositionWeight)
            || !portfolioReportWeight(concentration.topThreeWeight)
            || !portfolioReportWeight(concentration.hhi) {
            errors.append("concentration is invalid")
        }
        let weights = positions.map(\.weight).sorted(by: >)
        if concentration.largestPositionWeight != portfolioReportRound(weights.first ?? 0)
            || concentration.topThreeWeight != portfolioReportRound(weights.prefix(3).reduce(0, +))
            || concentration.hhi != portfolioReportRound(weights.reduce(0) { $0 + $1 * $1 }) {
            errors.append("concentration does not recompute from exact weights")
        }
    }
}

private extension PortfolioReportExplanationScenario {
    func validate(holdings: PortfolioReportExplanationHoldings, errors: inout [String]) {
        if scenarioId.isEmpty || !portfolioReportNonnegative(userInputAmount)
            || userInputAmount > 1_000_000_000_000
            || !portfolioReportWeight(candidateWeight)
            || !portfolioReportWeight(largestPositionWeight) || !portfolioReportWeight(hhi)
            || !candidateWeightChange.isFinite || !largestPositionWeightChange.isFinite || !hhiChange.isFinite
            || portfolioReportRound(candidateWeight - holdings.candidate.weight) != candidateWeightChange
            || portfolioReportRound(largestPositionWeight - holdings.concentration.largestPositionWeight) != largestPositionWeightChange
            || portfolioReportRound(hhi - holdings.concentration.hhi) != hhiChange {
            errors.append("scenario is invalid")
        }
    }
}

private extension PortfolioReportExplanationSafety {
    func validate(errors: inout [String]) {
        if !advisoryOnly || !readOnly || recommendation || ranking || score || suggestedAmount
            || targetWeight || targetPrice || tradeDirection || createsOrder || createsTrade
            || callsBroker || mutatesOfficialPortfolio || reportWrite || decisionWrite || productionWrite {
            errors.append("safety boundary is invalid")
        }
    }
}

private func portfolioReportPositiveId(_ value: String) -> Bool {
    value.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil
}

private func portfolioReportSHA(_ value: String) -> Bool {
    value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
}

private func portfolioReportDate(_ value: String) -> Bool {
    value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
}

private func portfolioReportUnique(_ values: [String]) -> [String] {
    values.reduce(into: []) { result, value in
        if !result.contains(value) { result.append(value) }
    }
}

private func portfolioReportNonnegative(_ value: Double) -> Bool {
    value.isFinite && value >= 0
}

private func portfolioReportWeight(_ value: Double) -> Bool {
    portfolioReportNonnegative(value) && value <= 1
}

private func portfolioReportRound(_ value: Double, digits: Int = 8) -> Double {
    let factor = pow(10, Double(digits))
    return round((value + .ulpOfOne) * factor) / factor
}
