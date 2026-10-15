import Foundation

public enum DecisionSnapshotPortfolioState: String, Codable, Equatable, Sendable {
    case current, stale, partial, zeroPosition = "zero_position"
    case empty
    case conflict
    case unauthorized
    case unavailable
    case notCaptured = "not_captured"
}
public enum DecisionSnapshotRiskAvailability: String, Codable, Equatable, Sendable {
    case captured
    case notCaptured = "not_captured"
}

public enum DecisionSnapshotAvailability: String, Codable, Equatable, Sendable {
    case preserved
    case notCaptured = "decision_snapshot_not_captured"
}

public enum DecisionSnapshotValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct DecisionSnapshotBinding: Codable, Equatable, Sendable {
    public static let schemaVersionV1 = "2026-07-16.decision-snapshot.v1"

    public let schemaVersion: String
    public let portfolioContext: DecisionSnapshotPortfolioBinding
    public let riskImpact: DecisionSnapshotRiskBinding

    public init(
        schemaVersion: String = Self.schemaVersionV1,
        portfolioContext: DecisionSnapshotPortfolioBinding,
        riskImpact: DecisionSnapshotRiskBinding
    ) {
        self.schemaVersion = schemaVersion
        self.portfolioContext = portfolioContext
        self.riskImpact = riskImpact
    }

    public static func capture(
        portfolioContext: PortfolioDecisionContextEnvelope?,
        riskImpact: PortfolioRiskImpactEnvelope?
    ) throws -> DecisionSnapshotBinding {
        let portfolio = portfolioContext.flatMap { context in
            context.status != .unauthorized && context.accountScopeId != nil
                ? DecisionSnapshotPortfolioBinding(context: context)
                : nil
        } ?? .notCaptured
        let risk = riskImpact?.status == .available
            ? DecisionSnapshotRiskBinding(impact: riskImpact!)
            : .notCaptured
        let binding = DecisionSnapshotBinding(portfolioContext: portfolio, riskImpact: risk)
        try binding.validate()
        return binding
    }

    public func validate() throws {
        var errors: [String] = []
        if schemaVersion != Self.schemaVersionV1 {
            errors.append("decision snapshot binding schemaVersion is invalid")
        }
        portfolioContext.validate(errors: &errors)
        riskImpact.validate(portfolio: portfolioContext, errors: &errors)
        if !errors.isEmpty {
            throw DecisionSnapshotValidationError.invalid(errors)
        }
    }
}

public struct DecisionSnapshotPortfolioBinding: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case state
        case contextId
        case portfolioSnapshotId
        case accountScopeId
    }

    public let state: DecisionSnapshotPortfolioState
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let accountScopeId: String?

    public static let notCaptured = DecisionSnapshotPortfolioBinding(
        state: .notCaptured,
        contextId: nil,
        portfolioSnapshotId: nil,
        accountScopeId: nil
    )

    public init(
        state: DecisionSnapshotPortfolioState,
        contextId: String?,
        portfolioSnapshotId: String?,
        accountScopeId: String?
    ) {
        self.state = state
        self.contextId = contextId
        self.portfolioSnapshotId = portfolioSnapshotId
        self.accountScopeId = accountScopeId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(DecisionSnapshotPortfolioState.self, forKey: .state)
        contextId = try decodeRequiredNullableString(container, forKey: .contextId)
        portfolioSnapshotId = try decodeRequiredNullableString(container, forKey: .portfolioSnapshotId)
        accountScopeId = try decodeRequiredNullableString(container, forKey: .accountScopeId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try container.encodeRequiredNullable(contextId, forKey: .contextId)
        try container.encodeRequiredNullable(portfolioSnapshotId, forKey: .portfolioSnapshotId)
        try container.encodeRequiredNullable(accountScopeId, forKey: .accountScopeId)
    }

    fileprivate init(context: PortfolioDecisionContextEnvelope) {
        state = switch context.status {
        case .available: .current
        case .stale: .stale
        case .partial: .partial
        case .zeroPosition: .zeroPosition
        case .empty: .empty
        case .conflict: .conflict
        case .unauthorized: .unauthorized
        case .unavailable: .unavailable
        }
        contextId = context.contextId
        portfolioSnapshotId = context.portfolioSnapshotId
        accountScopeId = context.accountScopeId
    }

    fileprivate func validate(errors: inout [String]) {
        for (value, label) in [
            (contextId, "portfolio contextId"),
            (portfolioSnapshotId, "portfolio snapshotId"),
            (accountScopeId, "portfolio accountScopeId")
        ] where value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            errors.append("decision snapshot binding \(label) must be non-empty when present")
        }
        switch state {
        case .current, .stale, .partial, .zeroPosition:
            if contextId == nil || portfolioSnapshotId == nil || accountScopeId == nil {
                errors.append("displayable decision snapshot portfolio binding requires all identities")
            }
        case .notCaptured:
            if contextId != nil || portfolioSnapshotId != nil || accountScopeId != nil {
                errors.append("not-captured decision snapshot portfolio binding must not expose identities")
            }
        case .empty, .conflict, .unauthorized, .unavailable:
            if contextId != nil || portfolioSnapshotId != nil {
                errors.append("fail-closed decision snapshot portfolio binding must not expose context or snapshot identities")
            }
        }
    }
}

public struct DecisionSnapshotRiskBinding: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case availability
        case impactId
        case calculationVersion
        case contextId
        case portfolioSnapshotId
        case candidateSymbol
        case hypotheticalAmount
    }

    public let availability: DecisionSnapshotRiskAvailability
    public let impactId: String?
    public let calculationVersion: String?
    public let contextId: String?
    public let portfolioSnapshotId: String?
    public let candidateSymbol: String?
    public let hypotheticalAmount: Double?

    public static let notCaptured = DecisionSnapshotRiskBinding(
        availability: .notCaptured,
        impactId: nil,
        calculationVersion: nil,
        contextId: nil,
        portfolioSnapshotId: nil,
        candidateSymbol: nil,
        hypotheticalAmount: nil
    )

    public init(
        availability: DecisionSnapshotRiskAvailability,
        impactId: String?,
        calculationVersion: String?,
        contextId: String?,
        portfolioSnapshotId: String?,
        candidateSymbol: String?,
        hypotheticalAmount: Double?
    ) {
        self.availability = availability
        self.impactId = impactId
        self.calculationVersion = calculationVersion
        self.contextId = contextId
        self.portfolioSnapshotId = portfolioSnapshotId
        self.candidateSymbol = candidateSymbol
        self.hypotheticalAmount = hypotheticalAmount
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        availability = try container.decode(DecisionSnapshotRiskAvailability.self, forKey: .availability)
        impactId = try decodeRequiredNullableString(container, forKey: .impactId)
        calculationVersion = try decodeRequiredNullableString(container, forKey: .calculationVersion)
        contextId = try decodeRequiredNullableString(container, forKey: .contextId)
        portfolioSnapshotId = try decodeRequiredNullableString(container, forKey: .portfolioSnapshotId)
        candidateSymbol = try decodeRequiredNullableString(container, forKey: .candidateSymbol)
        guard container.contains(.hypotheticalAmount) else {
            throw DecodingError.keyNotFound(
                CodingKeys.hypotheticalAmount,
                DecodingError.Context(codingPath: container.codingPath, debugDescription: "Required nullable key is missing")
            )
        }
        hypotheticalAmount = try container.decodeIfPresent(Double.self, forKey: .hypotheticalAmount)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(availability, forKey: .availability)
        try container.encodeRequiredNullable(impactId, forKey: .impactId)
        try container.encodeRequiredNullable(calculationVersion, forKey: .calculationVersion)
        try container.encodeRequiredNullable(contextId, forKey: .contextId)
        try container.encodeRequiredNullable(portfolioSnapshotId, forKey: .portfolioSnapshotId)
        try container.encodeRequiredNullable(candidateSymbol, forKey: .candidateSymbol)
        try container.encodeRequiredNullable(hypotheticalAmount, forKey: .hypotheticalAmount)
    }

    fileprivate init(impact: PortfolioRiskImpactEnvelope) {
        availability = .captured
        impactId = impact.impactId
        calculationVersion = impact.calculationVersion
        contextId = impact.contextId
        portfolioSnapshotId = impact.portfolioSnapshotId
        candidateSymbol = impact.candidateSymbol
        hypotheticalAmount = impact.hypotheticalAmount
    }

    fileprivate func validate(portfolio: DecisionSnapshotPortfolioBinding, errors: inout [String]) {
        switch availability {
        case .captured:
            if impactId == nil || calculationVersion == nil || contextId == nil || portfolioSnapshotId == nil || candidateSymbol == nil || !isPortfolioDecisionFiniteNonNegative(hypotheticalAmount) {
                errors.append("captured decision snapshot risk binding requires complete identities and amount")
            }
            if candidateSymbol.map(isPortfolioDecisionCanonicalHongKongSymbol) != true {
                errors.append("captured decision snapshot risk binding requires a canonical Hong Kong symbol")
            }
            if portfolio.state != .current || contextId != portfolio.contextId || portfolioSnapshotId != portfolio.portfolioSnapshotId {
                errors.append("captured decision snapshot risk binding must match current portfolio binding")
            }
        case .notCaptured:
            if impactId != nil || calculationVersion != nil || contextId != nil || portfolioSnapshotId != nil || candidateSymbol != nil || hypotheticalAmount != nil {
                errors.append("not-captured decision snapshot risk binding must not expose identities or amount")
            }
        }
    }
}

public struct DecisionSnapshotState: Codable, Equatable, Sendable {
    public static let historicalNotCaptured = DecisionSnapshotState(
        availability: .notCaptured,
        snapshot: nil,
        limitation: "This historical decision snapshot was not captured and is not reconstructed from current candidate, quote, research, portfolio, or risk facts."
    )

    public let availability: DecisionSnapshotAvailability
    public let snapshot: DecisionSnapshotEnvelope?
    public let limitation: String

    public func validateForDisplay(
        decisionContext: DecisionContextEnvelope,
        binding: DecisionSnapshotBinding? = nil
    ) throws {
        var errors: [String] = []
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision snapshot limitation is required")
        }
        switch availability {
        case .notCaptured:
            if snapshot != nil {
                errors.append("not-captured decision snapshot must not expose a snapshot")
            }
            if !limitation.contains("not reconstructed") {
                errors.append("not-captured decision snapshot must disclose no reconstruction")
            }
        case .preserved:
            guard let snapshot else {
                errors.append("preserved decision snapshot requires a snapshot")
                break
            }
            snapshot.validateForDisplay(decisionContext: decisionContext, binding: binding, errors: &errors)
        }
        if !errors.isEmpty {
            throw DecisionSnapshotValidationError.invalid(errors)
        }
    }

    public func binding() throws -> DecisionSnapshotBinding {
        guard availability == .preserved, let snapshot else {
            throw DecisionSnapshotValidationError.invalid([
                "preserved conditional decision requires one immutable decision snapshot binding"
            ])
        }
        let binding = DecisionSnapshotBinding(
            schemaVersion: snapshot.schemaVersion,
            portfolioContext: DecisionSnapshotPortfolioBinding(
                state: snapshot.portfolioContext.state,
                contextId: snapshot.portfolioContext.envelope?.contextId,
                portfolioSnapshotId: snapshot.portfolioContext.envelope?.portfolioSnapshotId,
                accountScopeId: snapshot.portfolioContext.envelope?.accountScopeId
            ),
            riskImpact: DecisionSnapshotRiskBinding(
                availability: snapshot.riskImpact.availability,
                impactId: snapshot.riskImpact.envelope?.impactId,
                calculationVersion: snapshot.riskImpact.envelope?.calculationVersion,
                contextId: snapshot.riskImpact.envelope?.contextId,
                portfolioSnapshotId: snapshot.riskImpact.envelope?.portfolioSnapshotId,
                candidateSymbol: snapshot.riskImpact.envelope?.candidateSymbol,
                hypotheticalAmount: snapshot.riskImpact.envelope?.hypotheticalAmount
            )
        )
        try binding.validate()
        return binding
    }
}

public struct DecisionSnapshotEnvelope: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let snapshotId: String
    public let capturedAt: String
    public let candidateSymbol: String
    public let decisionContext: DecisionContextEnvelope
    public let portfolioContext: DecisionSnapshotPortfolioStateEnvelope
    public let riskImpact: DecisionSnapshotRiskStateEnvelope
    public let safety: DecisionSnapshotSafety

    fileprivate func validateForDisplay(
        decisionContext expectedContext: DecisionContextEnvelope,
        binding: DecisionSnapshotBinding?,
        errors: inout [String]
    ) {
        if schemaVersion != DecisionSnapshotBinding.schemaVersionV1 {
            errors.append("decision snapshot schemaVersion is invalid")
        }
        if snapshotId.range(of: #"^decision-snapshot:[a-f0-9]{64}$"#, options: .regularExpression) == nil {
            errors.append("decision snapshot snapshotId is invalid")
        }
        if !isDecisionSnapshotDate(capturedAt) {
            errors.append("decision snapshot capturedAt is invalid")
        }
        if candidateSymbol != expectedContext.requestedSymbol
            || decisionContext.contextId != expectedContext.contextId
            || decisionContext.contextHash != expectedContext.contextHash {
            errors.append("decision snapshot must preserve the submitted decision context")
        }
        if let parsed = SecuritySymbol.parseHongKongAlias(candidateSymbol) {
            do {
                try decisionContext.validateForDisplay(market: parsed.market, code: parsed.code)
            } catch {
                errors.append("decision snapshot decision context is invalid")
            }
        } else {
            errors.append("decision snapshot candidateSymbol is invalid")
        }
        portfolioContext.validate(errors: &errors)
        riskImpact.validate(portfolio: portfolioContext, candidateSymbol: candidateSymbol, errors: &errors)
        safety.validate(errors: &errors)
        if let binding {
            portfolioContext.validate(binding: binding.portfolioContext, errors: &errors)
            riskImpact.validate(binding: binding.riskImpact, errors: &errors)
        }
    }
}

public struct DecisionSnapshotPortfolioStateEnvelope: Codable, Equatable, Sendable {
    public let state: DecisionSnapshotPortfolioState
    public let envelope: PortfolioDecisionContextEnvelope?
    public let limitation: String

    fileprivate func validate(errors: inout [String]) {
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision snapshot portfolio limitation is required")
        }
        if state == .notCaptured {
            if envelope != nil { errors.append("not-captured decision snapshot portfolio must not expose facts") }
            return
        }
        guard let envelope else {
            errors.append("captured decision snapshot portfolio state requires an envelope")
            return
        }
        do { try envelope.validateForDisplay() } catch { errors.append("decision snapshot portfolio envelope is invalid") }
        let expected: DecisionSnapshotPortfolioState = switch envelope.status {
        case .available: .current
        case .stale: .stale
        case .partial: .partial
        case .zeroPosition: .zeroPosition
        case .empty: .empty
        case .conflict: .conflict
        case .unauthorized: .unauthorized
        case .unavailable: .unavailable
        }
        if state != expected { errors.append("decision snapshot portfolio state must match its envelope") }
    }

    fileprivate func validate(binding: DecisionSnapshotPortfolioBinding, errors: inout [String]) {
        if state != binding.state { errors.append("decision snapshot portfolio state must match submitted binding") }
        if let envelope {
            if envelope.contextId != binding.contextId || envelope.portfolioSnapshotId != binding.portfolioSnapshotId || envelope.accountScopeId != binding.accountScopeId {
                errors.append("decision snapshot portfolio identities must match submitted binding")
            }
        } else if binding.state != .notCaptured {
            errors.append("decision snapshot must preserve the bound portfolio envelope")
        }
    }
}

public struct DecisionSnapshotRiskStateEnvelope: Codable, Equatable, Sendable {
    public let availability: DecisionSnapshotRiskAvailability
    public let envelope: PortfolioRiskImpactEnvelope?
    public let limitation: String

    fileprivate func validate(
        portfolio: DecisionSnapshotPortfolioStateEnvelope,
        candidateSymbol: String,
        errors: inout [String]
    ) {
        if limitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("decision snapshot risk limitation is required")
        }
        if availability == .notCaptured {
            if envelope != nil { errors.append("not-captured decision snapshot risk must not expose calculations") }
            return
        }
        guard let envelope, let context = portfolio.envelope, let amount = envelope.hypotheticalAmount else {
            errors.append("captured decision snapshot risk requires complete portfolio and risk facts")
            return
        }
        do {
            try validatePortfolioRiskImpactBinding(
                impact: envelope,
                context: context,
                candidateSymbol: candidateSymbol,
                hypotheticalAmount: amount
            )
        } catch {
            errors.append("decision snapshot risk does not match preserved portfolio facts")
        }
    }

    fileprivate func validate(binding: DecisionSnapshotRiskBinding, errors: inout [String]) {
        if availability != binding.availability { errors.append("decision snapshot risk availability must match submitted binding") }
        if let envelope {
            if envelope.impactId != binding.impactId
                || envelope.calculationVersion != binding.calculationVersion
                || envelope.contextId != binding.contextId
                || envelope.portfolioSnapshotId != binding.portfolioSnapshotId
                || envelope.candidateSymbol != binding.candidateSymbol
                || envelope.hypotheticalAmount != binding.hypotheticalAmount {
                errors.append("decision snapshot risk identities and amount must match submitted binding")
            }
        } else if binding.availability != .notCaptured {
            errors.append("decision snapshot must preserve the bound risk envelope")
        }
    }
}

public struct DecisionSnapshotSafety: Codable, Equatable, Sendable {
    public let advisoryOnly: Bool
    public let officialPortfolioMutation: Bool
    public let officialReviewMutation: Bool
    public let createsOrder: Bool
    public let createsTrade: Bool
    public let mutatesCash: Bool
    public let writesFee: Bool
    public let mutatesPosition: Bool
    public let callsBroker: Bool
    public let productionWrite: Bool

    fileprivate func validate(errors: inout [String]) {
        if !advisoryOnly || officialPortfolioMutation || officialReviewMutation || createsOrder || createsTrade || mutatesCash || writesFee || mutatesPosition || callsBroker || productionWrite {
            errors.append("decision snapshot safety must remain advisory-only with every mutation boundary false")
        }
    }
}

private func isDecisionSnapshotDate(_ value: String) -> Bool {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil else {
        return false
    }
    return ISO8601DateFormatter().date(from: value) != nil || DateFormatter.decisionSnapshotFractional.date(from: value) != nil
}

private func decodeRequiredNullableString<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>,
    forKey key: Key
) throws -> String? {
    guard container.contains(key) else {
        throw DecodingError.keyNotFound(
            key,
            DecodingError.Context(codingPath: container.codingPath, debugDescription: "Required nullable key is missing")
        )
    }
    return try container.decodeIfPresent(String.self, forKey: key)
}

private extension KeyedEncodingContainer {
    mutating func encodeRequiredNullable<T: Encodable>(_ value: T?, forKey key: Key) throws {
        if let value {
            try encode(value, forKey: key)
        } else {
            try encodeNil(forKey: key)
        }
    }
}

private extension DateFormatter {
    static let decisionSnapshotFractional: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter
    }()
}
