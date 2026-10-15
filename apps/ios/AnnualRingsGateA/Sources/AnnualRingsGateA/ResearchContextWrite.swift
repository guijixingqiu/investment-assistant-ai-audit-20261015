import Foundation
public struct ResearchContextSourceMembership: Codable, Equatable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public init(_ membership: CandidateMembershipData) {
        membershipId = membership.id
        membershipVersion = membership.version
        symbol = membership.symbol
    }
}
public struct ResearchContextCitation: Codable, Equatable, Sendable {
    public let documentId: String
    public let pageNumber: Int
    public let pageTextSha256: String
    public let sourceType: String
    public let sourceUrl: String?
    public let sourceVersion: String
    public let sourceMembership: ResearchContextSourceMembership?
    private enum CodingKeys: String, CodingKey {
        case documentId, pageNumber, pageTextSha256, sourceType, sourceUrl, sourceVersion, sourceMembership
    }
    public init(
        documentId: String,
        pageNumber: Int,
        pageTextSha256: String,
        sourceType: String,
        sourceUrl: String?,
        sourceVersion: String,
        sourceMembership: ResearchContextSourceMembership? = nil
    ) {
        self.documentId = documentId
        self.pageNumber = pageNumber
        self.pageTextSha256 = pageTextSha256
        self.sourceType = sourceType
        self.sourceUrl = sourceUrl
        self.sourceVersion = sourceVersion
        self.sourceMembership = sourceMembership
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        documentId = try container.decode(String.self, forKey: .documentId)
        pageNumber = try container.decode(Int.self, forKey: .pageNumber)
        pageTextSha256 = try container.decode(String.self, forKey: .pageTextSha256)
        sourceType = try container.decode(String.self, forKey: .sourceType)
        sourceUrl = try container.decodeResearchContextNullable(String.self, forKey: .sourceUrl)
        sourceVersion = try container.decode(String.self, forKey: .sourceVersion)
        sourceMembership = try container.decodeIfPresent(ResearchContextSourceMembership.self, forKey: .sourceMembership)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(documentId, forKey: .documentId)
        try container.encode(pageNumber, forKey: .pageNumber)
        try container.encode(pageTextSha256, forKey: .pageTextSha256)
        try container.encode(sourceType, forKey: .sourceType)
        if let sourceUrl { try container.encode(sourceUrl, forKey: .sourceUrl) }
        else { try container.encodeNil(forKey: .sourceUrl) }
        try container.encode(sourceVersion, forKey: .sourceVersion)
        try container.encodeIfPresent(sourceMembership, forKey: .sourceMembership)
    }
}

public struct ResearchContextNumericFact: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let selectedSymbol: String
    public let symbol: String
    public let metric: String
    public let value: String?
    public let unit: String
    public let currency: String?
    public let periodStart: String?
    public let periodEnd: String?
    public let asOf: String
    public let cutoffAt: String
    public let validUntil: String
    public let citation: ResearchPeerCitation
    public let provenance: ResearchContextProvenance

    private enum CodingKeys: String, CodingKey {
        case id, selectedSymbol, symbol, metric, value, unit, currency, periodStart, periodEnd
        case asOf, cutoffAt, validUntil, citation, provenance
    }

    public init(
        id: String,
        selectedSymbol: String,
        symbol: String,
        metric: String,
        value: String?,
        unit: String,
        currency: String?,
        periodStart: String? = nil,
        periodEnd: String? = nil,
        asOf: String,
        cutoffAt: String,
        validUntil: String,
        citation: ResearchPeerCitation,
        provenance: ResearchContextProvenance
    ) {
        self.id = id
        self.selectedSymbol = selectedSymbol
        self.symbol = symbol
        self.metric = metric
        self.value = value
        self.unit = unit
        self.currency = currency
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.asOf = asOf
        self.cutoffAt = cutoffAt
        self.validUntil = validUntil
        self.citation = citation
        self.provenance = provenance
    }

    public init(id: String, selectedSymbol: String, symbol: String, metric: String,
                value: String?, unit: String, currency: String?, periodStart: String? = nil,
                periodEnd: String? = nil, asOf: String,
                cutoffAt: String, validUntil: String, citation: ResearchContextCitation,
                provenance: ResearchContextProvenance) {
        self.init(id: id, selectedSymbol: selectedSymbol, symbol: symbol, metric: metric,
            value: value, unit: unit, currency: currency, periodStart: periodStart,
            periodEnd: periodEnd, asOf: asOf, cutoffAt: cutoffAt,
            validUntil: validUntil, citation: .pdf(citation), provenance: provenance)
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        selectedSymbol = try container.decode(String.self, forKey: .selectedSymbol)
        symbol = try container.decode(String.self, forKey: .symbol)
        metric = try container.decode(String.self, forKey: .metric)
        value = try container.decodeResearchContextNullable(String.self, forKey: .value)
        unit = try container.decode(String.self, forKey: .unit)
        currency = try container.decodeResearchContextNullable(String.self, forKey: .currency)
        periodStart = try container.decodeIfPresent(String.self, forKey: .periodStart)
        periodEnd = try container.decodeIfPresent(String.self, forKey: .periodEnd)
        asOf = try container.decode(String.self, forKey: .asOf)
        cutoffAt = try container.decode(String.self, forKey: .cutoffAt)
        validUntil = try container.decode(String.self, forKey: .validUntil)
        citation = try container.decode(ResearchPeerCitation.self, forKey: .citation)
        provenance = try container.decode(ResearchContextProvenance.self, forKey: .provenance)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(selectedSymbol, forKey: .selectedSymbol)
        try container.encode(symbol, forKey: .symbol)
        try container.encode(metric, forKey: .metric)
        if let value { try container.encode(value, forKey: .value) }
        else { try container.encodeNil(forKey: .value) }
        try container.encode(unit, forKey: .unit)
        if let currency { try container.encode(currency, forKey: .currency) }
        else { try container.encodeNil(forKey: .currency) }
        try container.encodeIfPresent(periodStart, forKey: .periodStart)
        try container.encodeIfPresent(periodEnd, forKey: .periodEnd)
        try container.encode(asOf, forKey: .asOf)
        try container.encode(cutoffAt, forKey: .cutoffAt)
        try container.encode(validUntil, forKey: .validUntil)
        try container.encode(citation, forKey: .citation)
        try container.encode(provenance, forKey: .provenance)
    }
}

public struct CreateResearchContextRequest: Codable, Equatable, Sendable {
    public var operatingModel: OperatingResearchModel? = nil
    public let baseContextId: String?
    public let membershipVersion: Int
    public let selectedSymbol: String
    public let industry: String
    public let selectedFacts: [ResearchContextNumericFact]
    public let peerFacts: [ResearchContextNumericFact]
    public let peers: [ResearchContextPeer]
    public let operatingKpis: [ResearchOperatingKpi]
    public let macroDrivers: [ResearchContextDriver]
    public let industryDrivers: [ResearchContextDriver]
    public let unknowns: [String]
    public let provenance: ResearchContextProvenance
    public let asOf: String
    public let cutoffAt: String
    public let validUntil: String
    public let idempotencyKey: String

    private enum CodingKeys: String, CodingKey {
        case operatingModel, baseContextId, membershipVersion, selectedSymbol, industry, selectedFacts
        case peerFacts, peers, operatingKpis, macroDrivers, industryDrivers, unknowns, provenance
        case asOf, cutoffAt, validUntil, idempotencyKey
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let baseContextId { try container.encode(baseContextId, forKey: .baseContextId) }
        else { try container.encodeNil(forKey: .baseContextId) }
        try container.encodeIfPresent(operatingModel, forKey: .operatingModel)
        try container.encode(membershipVersion, forKey: .membershipVersion)
        try container.encode(selectedSymbol, forKey: .selectedSymbol)
        try container.encode(industry, forKey: .industry)
        try container.encode(selectedFacts, forKey: .selectedFacts)
        try container.encode(peerFacts, forKey: .peerFacts)
        try container.encode(peers, forKey: .peers)
        try container.encode(operatingKpis, forKey: .operatingKpis)
        try container.encode(macroDrivers, forKey: .macroDrivers)
        try container.encode(industryDrivers, forKey: .industryDrivers)
        try container.encode(unknowns, forKey: .unknowns)
        try container.encode(provenance, forKey: .provenance)
        try container.encode(asOf, forKey: .asOf)
        try container.encode(cutoffAt, forKey: .cutoffAt)
        try container.encode(validUntil, forKey: .validUntil)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

public enum ResearchContextDraftKind: String, CaseIterable, Hashable, Identifiable, Sendable {
    case selectedFact = "selected_fact"
    case peerFact = "peer_fact"
    case operatingKpi = "operating_kpi"
    case macroDriver = "macro_driver"
    case industryDriver = "industry_driver"

    public var id: String { rawValue }
}

public struct ResearchContextDraft: Equatable, Sendable {
    public let industry: String
    public let kind: ResearchContextDraftKind
    public let documentId: String
    public let pageNumber: Int
    public let peerSymbol: String
    public let peerName: String
    public let peerStatus: String
    public let peerReason: String
    public let metric: String
    public let value: String
    public let unit: String
    public let currency: String
    public let factPeriodMode: String
    public let statement: String
    public let kpiCategory: String
    public let periodStart: Date
    public let periodEnd: Date
    public let comparable: Bool
    public let comparabilityReason: String
    public let dimension: String
    public let impact: String
    public let thesisRelevance: String
    public let unknowns: String
    public let validUntil: Date

    public init(
        industry: String,
        kind: ResearchContextDraftKind,
        documentId: String,
        pageNumber: Int,
        peerSymbol: String,
        peerName: String = "",
        peerStatus: String = "included",
        peerReason: String = "",
        metric: String,
        value: String,
        unit: String,
        currency: String,
        factPeriodMode: String = "none",
        statement: String,
        kpiCategory: String = "operating",
        periodStart: Date = Date(),
        periodEnd: Date = Date(),
        comparable: Bool = true,
        comparabilityReason: String = "",
        dimension: String = "demand",
        impact: String = "unknown",
        thesisRelevance: String = "",
        unknowns: String,
        validUntil: Date
    ) {
        self.industry = industry
        self.kind = kind
        self.documentId = documentId
        self.pageNumber = pageNumber
        self.peerSymbol = peerSymbol
        self.peerName = peerName
        self.peerStatus = peerStatus
        self.peerReason = peerReason
        self.metric = metric
        self.value = value
        self.unit = unit
        self.currency = currency
        self.factPeriodMode = factPeriodMode
        self.statement = statement
        self.kpiCategory = kpiCategory
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.comparable = comparable
        self.comparabilityReason = comparabilityReason
        self.dimension = dimension
        self.impact = impact
        self.thesisRelevance = thesisRelevance
        self.unknowns = unknowns
        self.validUntil = validUntil
    }

    public var semanticFingerprint: String {
        let fields = [
            industry, kind.rawValue, documentId, String(pageNumber), peerSymbol,
            peerName, peerStatus, peerReason, metric, value, unit, currency
        ] + ((kind == .selectedFact || kind == .peerFact) && factPeriodMode != "none"
            ? [factPeriodMode] : []) + [
            statement,
            kpiCategory, ISO8601DateFormatter().string(from: periodStart), ISO8601DateFormatter().string(from: periodEnd),
            String(comparable), comparabilityReason, dimension, impact, thesisRelevance, unknowns,
            ISO8601DateFormatter().string(from: validUntil)
        ]
        return fields.map { "\(Data($0.utf8).count):\($0)" }.joined(separator: "|")
    }

    public func request(
        membership: CandidateMembershipData,
        document: ResearchDocumentData,
        page: ResearchDocumentPageData,
        current: ResearchContextData? = nil,
        baseContextId: String? = nil,
        idempotencyKey: String,
        now: Date = Date()
    ) throws -> CreateResearchContextRequest {
        let industry = industry.trimmingCharacters(in: .whitespacesAndNewlines)
        let metric = metric.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let unit = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        let currency = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let statement = statement.trimmingCharacters(in: .whitespacesAndNewlines)
        let peerName = peerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let peerReason = peerReason.trimmingCharacters(in: .whitespacesAndNewlines)
        let comparabilityReason = comparabilityReason.trimmingCharacters(in: .whitespacesAndNewlines)
        let thesisRelevance = thesisRelevance.trimmingCharacters(in: .whitespacesAndNewlines)
        let peer = SecuritySymbol.parseHongKongAlias(peerSymbol)?.canonical
        let calendar = Calendar(identifier: .gregorian)
        let periodStart = ResearchFundamentalCalendarDate.string(from: periodStart, calendar: calendar)
        let periodEnd = ResearchFundamentalCalendarDate.string(from: periodEnd, calendar: calendar)
        let parsedUnknowns = unknowns
            .split(whereSeparator: \Character.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let validUntil = ISO8601DateFormatter().string(from: validUntil)
        var errors: [String] = []
        if membership.state == .archived || document.membershipId != membership.id
            || document.membershipVersionAtImport != membership.version
            || document.symbol != membership.symbol || document.sourceState != "available"
            || document.rightsStatus != "user_provided" || documentId != document.id
            || page.documentId != document.id || page.pageNumber != pageNumber
            || !researchDocumentIsSha256(page.pageTextSha256) {
            errors.append("PDF citation does not match the current research membership")
        }
        if let current,
           (current.membershipId != membership.id
            || current.membershipVersion != membership.version
            || current.selectedSymbol != membership.symbol
            || current.currentness.status != "current"
            || !current.currentness.invalidatedBy.isEmpty
            || !current.safety.isAdvisoryOnly) {
            errors.append("current research context does not match the selected membership")
        }
        if !isBoundedResearchContextString(industry, max: 200) {
            errors.append("industry is required and must contain at most 200 characters")
        }
        guard let sourceDate = researchContextDate(document.publishedAt),
              let capturedDate = researchContextDate(document.importedAt),
              let validUntilDate = researchContextDate(validUntil) else {
            throw ResearchContextDraftError.invalid(errors + ["context timeline is invalid"])
        }
        if sourceDate > now || capturedDate > now || validUntilDate <= now {
            errors.append("context timeline must be current and cannot use future source facts")
        }
        if parsedUnknowns.count > 100 || parsedUnknowns.contains(where: {
            !isBoundedResearchContextString($0, max: 500)
        }) {
            errors.append("unknowns must contain at most 100 lines of 500 characters")
        }
        switch kind {
        case .selectedFact, .peerFact:
            if !isBoundedResearchContextString(metric, max: 200)
                || !isBoundedResearchContextString(unit, max: 100)
                || !value.isEmpty && !isCanonicalResearchContextDecimal(value)
                || !currency.isEmpty && !isResearchContextCurrency(currency) {
                errors.append("numeric fact requires a metric, unit, optional canonical decimal, and optional currency")
            }
            if kind == .peerFact && (peer == nil || peer == membership.symbol) {
                errors.append("peer fact requires a different canonical Hong Kong symbol")
            }
            if kind == .peerFact && (!isBoundedResearchContextString(peerName, max: 200)
                || !["included", "excluded"].contains(peerStatus)
                || !isBoundedResearchContextString(peerReason, max: 1_000)) {
                errors.append("peer fact requires an applicability or exclusion reason")
            }
            if !["none", "point", "duration"].contains(factPeriodMode)
                || factPeriodMode != "none" && (periodEnd == nil
                    || researchContextDate("\(periodEnd!)T00:00:00Z").map({ $0 <= sourceDate }) != true
                    || factPeriodMode == "duration" && (periodStart == nil || periodStart! >= periodEnd!)) {
                errors.append("fact measurement period must be explicit and precede its source")
            }
        case .operatingKpi:
            if !["operating", "price"].contains(kpiCategory)
                || !isBoundedResearchContextString(metric, max: 200)
                || !isBoundedResearchContextString(unit, max: 100)
                || !value.isEmpty && !isCanonicalResearchContextDecimal(value)
                || periodStart == nil || periodEnd == nil || periodStart! >= periodEnd!
                || !comparable && !isBoundedResearchContextString(comparabilityReason, max: 500) {
                errors.append("KPI requires category, period, unit, value or UNKNOWN, and comparability")
            }
        case .macroDriver, .industryDriver:
            let dimensions = kind == .industryDriver
                ? ["supply", "demand", "pricing", "competition", "policy", "cycle"]
                : ["growth", "inflation", "rates", "fx", "commodities", "policy"]
            if !isBoundedResearchContextString(statement, max: 4_000)
                || !dimensions.contains(dimension)
                || !["supportive", "adverse", "mixed", "unknown"].contains(impact)
                || !isBoundedResearchContextString(thesisRelevance, max: 1_000) {
                errors.append("driver requires typed dimension, impact, statement, and thesis relevance")
            }
        }
        if errors.isEmpty == false { throw ResearchContextDraftError.invalid(errors) }

        let citation = ResearchContextCitation(
            documentId: document.id,
            pageNumber: page.pageNumber,
            pageTextSha256: page.pageTextSha256,
            sourceType: "owner_provided_pdf",
            sourceUrl: nil,
            sourceVersion: document.sourceVersion
        )
        let provenance = ResearchContextProvenance(
            sourceType: "owner_provided_pdf",
            sourceVersion: document.sourceVersion,
            capturedAt: document.importedAt,
            classification: "user_provided"
        )
        let factIds = (current?.selectedFacts.map(\.id) ?? []) + (current?.peerFacts.map(\.id) ?? [])
        let driverIds = (current?.macroDrivers.map(\.id) ?? []) + (current?.industryDrivers.map(\.id) ?? [])
        let itemId: String
        switch kind {
        case .selectedFact:
            itemId = current?.selectedFacts.first(where: {
                $0.symbol == membership.symbol && $0.metric == metric
                    && $0.periodStart == (factPeriodMode == "duration" ? periodStart : nil)
                    && $0.periodEnd == (factPeriodMode == "none" ? nil : periodEnd)
            })?.id ?? nextResearchContextItemId(factIds)
        case .peerFact:
            itemId = current?.peerFacts.first(where: {
                $0.symbol == peer! && $0.metric == metric
                    && $0.periodStart == (factPeriodMode == "duration" ? periodStart : nil)
                    && $0.periodEnd == (factPeriodMode == "none" ? nil : periodEnd)
            })?.id ?? nextResearchContextItemId(factIds)
        case .operatingKpi:
            itemId = current?.operatingKpis.first(where: {
                $0.category == kpiCategory && $0.metric == metric && $0.periodEnd == periodEnd
            })?.id ?? nextResearchContextItemId(current?.operatingKpis.map(\.id) ?? [])
        case .macroDriver:
            itemId = current?.macroDrivers.first(where: { $0.dimension == dimension })?.id
                ?? nextResearchContextItemId(driverIds)
        case .industryDriver:
            itemId = current?.industryDrivers.first(where: { $0.dimension == dimension })?.id
                ?? nextResearchContextItemId(driverIds)
        }
        let fact = ResearchContextNumericFact(
            id: itemId,
            selectedSymbol: membership.symbol,
            symbol: kind == .peerFact ? peer! : membership.symbol,
            metric: metric,
            value: value.isEmpty ? nil : value,
            unit: unit,
            currency: currency.isEmpty ? nil : currency,
            periodStart: factPeriodMode == "duration" ? periodStart : nil,
            periodEnd: factPeriodMode == "none" ? nil : periodEnd,
            asOf: document.publishedAt,
            cutoffAt: document.publishedAt,
            validUntil: validUntil,
            citation: citation,
            provenance: provenance
        )
        let driver = ResearchContextDriver(
            id: itemId,
            selectedSymbol: membership.symbol,
            kind: kind == .macroDriver ? "macro" : "industry",
            dimension: dimension,
            impact: impact,
            statement: statement,
            thesisRelevance: thesisRelevance,
            asOf: document.publishedAt,
            cutoffAt: document.publishedAt,
            validUntil: validUntil,
            citation: citation,
            provenance: provenance
        )
        let peerItem = ResearchContextPeer(
            id: current?.peers.first(where: { $0.symbol == peer })?.id ?? itemId,
            selectedSymbol: membership.symbol, symbol: peer ?? "HK.00000",
            name: peerName, status: peerStatus, reason: peerReason,
            asOf: document.publishedAt, cutoffAt: document.publishedAt, validUntil: validUntil,
            citation: .pdf(citation), provenance: provenance
        )
        let kpi = ResearchOperatingKpi(
            id: itemId, selectedSymbol: membership.symbol, category: kpiCategory,
            metric: metric, periodStart: periodStart ?? "", periodEnd: periodEnd ?? "",
            valueStatus: value.isEmpty ? "explicit_unknown" : "reported", value: value.isEmpty ? nil : value,
            unit: unit, comparability: comparable ? "comparable" : "not_comparable",
            comparabilityReason: comparable ? nil : comparabilityReason,
            asOf: document.publishedAt, cutoffAt: document.publishedAt, validUntil: validUntil,
            citation: citation, provenance: provenance
        )
        var selectedFacts = current?.selectedFacts ?? []
        var peerFacts = current?.peerFacts ?? []
        var peers = current?.peers ?? []
        var operatingKpis = current?.operatingKpis ?? []
        var macroDrivers = current?.macroDrivers ?? []
        var industryDrivers = current?.industryDrivers ?? []
        switch kind {
        case .selectedFact:
            selectedFacts.removeAll { $0.id == itemId || ($0.symbol == fact.symbol && $0.metric == fact.metric
                && $0.periodStart == fact.periodStart && $0.periodEnd == fact.periodEnd) }
            selectedFacts.append(fact)
        case .peerFact:
            peerFacts.removeAll { $0.id == itemId || ($0.symbol == fact.symbol && $0.metric == fact.metric
                && $0.periodStart == fact.periodStart && $0.periodEnd == fact.periodEnd) }
            peerFacts.append(fact)
            peers.removeAll { $0.symbol == peerItem.symbol }
            peers.append(peerItem)
        case .operatingKpi:
            operatingKpis.removeAll { $0.id == itemId || ($0.category == kpi.category && $0.metric == kpi.metric && $0.periodEnd == kpi.periodEnd) }
            operatingKpis.append(kpi)
        case .macroDriver:
            macroDrivers.removeAll { $0.id == itemId || $0.dimension == driver.dimension }
            macroDrivers.append(driver)
        case .industryDriver:
            industryDrivers.removeAll { $0.id == itemId || $0.dimension == driver.dimension }
            industryDrivers.append(driver)
        }
        selectedFacts.sort { $0.id < $1.id }
        peerFacts.sort { $0.id < $1.id }
        peers.sort { $0.symbol < $1.symbol }
        operatingKpis.sort { $0.periodEnd > $1.periodEnd || ($0.periodEnd == $1.periodEnd && $0.id < $1.id) }
        macroDrivers.sort { $0.id < $1.id }
        industryDrivers.sort { $0.id < $1.id }
        let allAsOf = selectedFacts.map(\.asOf) + peerFacts.map(\.asOf) + peers.map(\.asOf) + operatingKpis.map(\.asOf)
            + macroDrivers.map(\.asOf) + industryDrivers.map(\.asOf)
        let allCutoffs = selectedFacts.map(\.cutoffAt) + peerFacts.map(\.cutoffAt) + peers.map(\.cutoffAt) + operatingKpis.map(\.cutoffAt)
            + macroDrivers.map(\.cutoffAt) + industryDrivers.map(\.cutoffAt)
        let allValidUntil = selectedFacts.map(\.validUntil) + peerFacts.map(\.validUntil) + peers.map(\.validUntil) + operatingKpis.map(\.validUntil)
            + macroDrivers.map(\.validUntil) + industryDrivers.map(\.validUntil)
        return CreateResearchContextRequest(
            operatingModel: current?.operatingModel,
            baseContextId: current?.id ?? baseContextId,
            membershipVersion: membership.version,
            selectedSymbol: membership.symbol,
            industry: industry,
            selectedFacts: selectedFacts,
            peerFacts: peerFacts,
            peers: peers,
            operatingKpis: operatingKpis,
            macroDrivers: macroDrivers,
            industryDrivers: industryDrivers,
            unknowns: parsedUnknowns,
            provenance: provenance,
            asOf: researchContextLatestInstant(allAsOf),
            cutoffAt: researchContextLatestInstant(allCutoffs),
            validUntil: researchContextEarliestInstant(allValidUntil),
            idempotencyKey: idempotencyKey
        )
    }
}

private func nextResearchContextItemId(_ ids: [String]) -> String {
    String((ids.compactMap(Int.init).max() ?? 0) + 1)
}

private func researchContextLatestInstant(_ values: [String]) -> String {
    values.max { (researchContextDate($0) ?? .distantPast) < (researchContextDate($1) ?? .distantPast) }!
}

private func researchContextEarliestInstant(_ values: [String]) -> String {
    values.min { (researchContextDate($0) ?? .distantFuture) < (researchContextDate($1) ?? .distantFuture) }!
}

extension ResearchClient {
    public func createResearchContextAndReadBack(
        membership: CandidateMembershipData,
        requestBody: CreateResearchContextRequest
    ) async throws -> ResearchContextEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membership.id)
            .appending(path: "research-context")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        applyWriteAuth(to: &request)
        request.httpBody = try JSONEncoder().encode(requestBody)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ResearchContextClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            throw ResearchContextClientError.httpStatus(http.statusCode)
        }
        let write: ResearchWriteEnvelope<ResearchContextData>
        do {
            write = try JSONDecoder().decode(
                ResearchWriteEnvelope<ResearchContextData>.self,
                from: data
            )
        } catch {
            throw ResearchContextClientError.invalidResponse
        }
        guard write.schemaVersion == "2026-06-18.research-write.v1",
              write.status == "succeeded",
              write.source.actorType == "user",
              write.source.actorId == membership.actorId,
              write.data.membershipId == membership.id,
              write.data.membershipVersion == requestBody.membershipVersion,
              write.data.selectedSymbol == requestBody.selectedSymbol,
              write.data.industry == requestBody.industry,
              (requestBody.operatingModel == nil || write.data.operatingModel == requestBody.operatingModel),
              write.data.selectedFacts == requestBody.selectedFacts,
              write.data.peerFacts == requestBody.peerFacts,
              write.data.peers == requestBody.peers,
              write.data.operatingKpis == requestBody.operatingKpis,
              write.data.macroDrivers == requestBody.macroDrivers,
              write.data.industryDrivers == requestBody.industryDrivers,
              write.data.unknowns == requestBody.unknowns,
              write.data.provenance == requestBody.provenance,
              write.data.asOf == requestBody.asOf,
              write.data.cutoffAt == requestBody.cutoffAt,
              write.data.validUntil == requestBody.validUntil else {
            throw ResearchContextClientError.invalidResponse
        }
        let fresh = try await fetchResearchContext(membership: membership)
        guard fresh.status == .available, fresh.data == write.data else {
            throw ResearchContextClientError.invalidResponse
        }
        return fresh
    }
}

private extension KeyedDecodingContainer {
    func decodeResearchContextNullable<T: Decodable>(
        _ type: T.Type,
        forKey key: Key
    ) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Required nullable key \(key.stringValue) is missing"
                )
            )
        }
        return try decodeIfPresent(type, forKey: key)
    }
}
