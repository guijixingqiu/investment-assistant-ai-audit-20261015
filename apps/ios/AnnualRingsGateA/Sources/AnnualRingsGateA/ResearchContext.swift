import Foundation

public enum ResearchContextStatus: String, Codable, Equatable, Sendable {
    case available
    case notFound = "not_found"
    case unavailable
}

public struct ResearchPeerSourceIssue: Codable, Equatable, Sendable {
    public let peerId: String
    public let symbol: String
    public let status: String
    public let reason: String

    public var explanation: String {
        reason == "material_changed"
            ? "已保存来源被替换、删除或身份变化；这条同行依据已过期，请重新选择来源并保存。"
            : "已保存原件暂不可重开；这条同行依据不可用，请核对来源后重新保存。"
    }
}

public struct ResearchPeerFactSourceIssue: Codable, Equatable, Sendable {
    public let factId: String
    public let symbol: String
    public let status: String
    public let reason: String
    public var explanation: String {
        reason == "material_changed"
            ? "这条同行事实的保存来源或成员身份已变化；请重新核对原件。"
            : "这条同行事实的原件暂不可重开；当前不能用于比较或研究发送。"
    }
}

public struct ResearchContextProvenance: Codable, Equatable, Sendable {
    public let sourceType: String
    public let sourceVersion: String
    public let capturedAt: String
    public let classification: String
}

public struct ResearchContextDriver: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let selectedSymbol: String
    public let kind: String
    public let dimension: String
    public let impact: String
    public let statement: String
    public let thesisRelevance: String
    public let asOf: String
    public let cutoffAt: String
    public let validUntil: String
    public let citation: ResearchContextCitation
    public let provenance: ResearchContextProvenance
}

public struct ResearchContextPeer: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let selectedSymbol: String
    public let symbol: String
    public let name: String
    public let status: String
    public let reason: String
    public let asOf: String
    public let cutoffAt: String
    public let validUntil: String
    public let citation: ResearchPeerCitation
    public let provenance: ResearchContextProvenance
}

public struct ResearchPeerMaterialCitation: Codable, Equatable, Sendable {
    public struct ProviderOriginal: Codable, Equatable, Sendable {
        public let captureId: String
        public let pageId: String
        public let rawSha256: String
        public let reportSha256: String
    }
    public let kind: String
    public let materialId: String
    public let materialRevision: Int
    public let contentFingerprint: String
    public let sourceType: String
    public let sourceUrl: String?
    public let sourceVersion: String
    public let sourceMembership: ResearchContextSourceMembership?
    public let snapshotCitation: ResearchSnapshotCitation?
    public let snapshotRawSha256: String?
    public let providerOriginal: ProviderOriginal?

    private enum CodingKeys: String, CodingKey {
        case kind, materialId, materialRevision, contentFingerprint, sourceType, sourceUrl
        case sourceVersion, sourceMembership, snapshotCitation, snapshotRawSha256, providerOriginal
    }

    public init(kind: String, materialId: String, materialRevision: Int,
                contentFingerprint: String, sourceType: String, sourceUrl: String?,
                sourceVersion: String, snapshotCitation: ResearchSnapshotCitation?,
                snapshotRawSha256: String?, providerOriginal: ProviderOriginal?,
                sourceMembership: ResearchContextSourceMembership? = nil) {
        self.kind = kind; self.materialId = materialId; self.materialRevision = materialRevision
        self.contentFingerprint = contentFingerprint; self.sourceType = sourceType
        self.sourceUrl = sourceUrl; self.sourceVersion = sourceVersion
        self.snapshotCitation = snapshotCitation; self.snapshotRawSha256 = snapshotRawSha256
        self.providerOriginal = providerOriginal; self.sourceMembership = sourceMembership
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(materialId, forKey: .materialId)
        try container.encode(materialRevision, forKey: .materialRevision)
        try container.encode(contentFingerprint, forKey: .contentFingerprint)
        try container.encode(sourceType, forKey: .sourceType)
        if let sourceUrl { try container.encode(sourceUrl, forKey: .sourceUrl) }
        else { try container.encodeNil(forKey: .sourceUrl) }
        try container.encode(sourceVersion, forKey: .sourceVersion)
        try container.encodeIfPresent(sourceMembership, forKey: .sourceMembership)
        try container.encodeIfPresent(snapshotCitation, forKey: .snapshotCitation)
        try container.encodeIfPresent(snapshotRawSha256, forKey: .snapshotRawSha256)
        try container.encodeIfPresent(providerOriginal, forKey: .providerOriginal)
    }
}

public enum ResearchPeerCitation: Codable, Equatable, Sendable {
    case pdf(ResearchContextCitation)
    case savedMaterial(ResearchPeerMaterialCitation)

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: MaterialKey.self)
        if try keys.decodeIfPresent(String.self, forKey: .kind) == "saved_material" {
            self = .savedMaterial(try ResearchPeerMaterialCitation(from: decoder))
        } else { self = .pdf(try ResearchContextCitation(from: decoder)) }
    }
    public func encode(to encoder: Encoder) throws {
        switch self {
        case .pdf(let value): try value.encode(to: encoder)
        case .savedMaterial(let value): try value.encode(to: encoder)
        }
    }
    private enum MaterialKey: String, CodingKey { case kind }

    public var sourceLabel: String {
        switch self {
        case .pdf(let value):
            return "\(value.sourceMembership?.symbol ?? "主公司") PDF #\(value.documentId) 第 \(value.pageNumber) 页"
        case .savedMaterial(let value):
            let owner = value.sourceMembership?.symbol ?? "主公司"
            return value.sourceType == "issuer_public_html"
                ? "\(owner) 已保存 HTML 材料 #\(value.materialId) · 快照 #\(value.snapshotCitation?.snapshotId ?? "UNKNOWN")"
                : "\(owner) OpenD 第三方材料 #\(value.materialId) · 捕获 #\(value.providerOriginal?.captureId ?? "UNKNOWN")"
        }
    }
    public var sourceVersion: String {
        switch self {
        case .pdf(let value): return value.sourceVersion
        case .savedMaterial(let value): return value.sourceVersion
        }
    }
    public var sourceMembership: ResearchContextSourceMembership? {
        switch self {
        case .pdf(let value): value.sourceMembership
        case .savedMaterial(let value): value.sourceMembership
        }
    }
}

public struct ResearchOperatingKpi: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let selectedSymbol: String
    public let category: String
    public let metric: String
    public let periodStart: String
    public let periodEnd: String
    public let valueStatus: String
    public let value: String?
    public let unit: String
    public let comparability: String
    public let comparabilityReason: String?
    public let asOf: String
    public let cutoffAt: String
    public let validUntil: String
    public let citation: ResearchContextCitation
    public let provenance: ResearchContextProvenance

    private enum CodingKeys: String, CodingKey {
        case id, selectedSymbol, category, metric, periodStart, periodEnd, valueStatus, value
        case unit, comparability, comparabilityReason, asOf, cutoffAt, validUntil, citation, provenance
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(selectedSymbol, forKey: .selectedSymbol)
        try container.encode(category, forKey: .category)
        try container.encode(metric, forKey: .metric)
        try container.encode(periodStart, forKey: .periodStart)
        try container.encode(periodEnd, forKey: .periodEnd)
        try container.encode(valueStatus, forKey: .valueStatus)
        if let value { try container.encode(value, forKey: .value) }
        else { try container.encodeNil(forKey: .value) }
        try container.encode(unit, forKey: .unit)
        try container.encode(comparability, forKey: .comparability)
        if let comparabilityReason { try container.encode(comparabilityReason, forKey: .comparabilityReason) }
        else { try container.encodeNil(forKey: .comparabilityReason) }
        try container.encode(asOf, forKey: .asOf)
        try container.encode(cutoffAt, forKey: .cutoffAt)
        try container.encode(validUntil, forKey: .validUntil)
        try container.encode(citation, forKey: .citation)
        try container.encode(provenance, forKey: .provenance)
    }
}

public struct ResearchContextComparison: Codable, Equatable, Identifiable, Sendable {
    public var id: String { "\(peerFactId):\(metric)" }
    public let peerSymbol: String
    public let metric: String
    public let selectedFactId: String?
    public let peerFactId: String
    public let unit: String
    public let currency: String?
    public let status: String
    public let selectedValue: String?
    public let peerValue: String?
    public let delta: String?
    public let reason: String?
    public let calculationVersion: String
}

public struct ResearchContextCurrentness: Codable, Equatable, Sendable {
    public let status: String
    public let invalidatedBy: [String]
}

public struct ResearchContextSafety: Codable, Equatable, Sendable {
    public let recommendation: Bool
    public let ranking: Bool
    public let automaticSignal: Bool
    public let createsOrder: Bool
    public let callsBroker: Bool
    public let mutatesOfficialPortfolio: Bool

    var isAdvisoryOnly: Bool {
        !recommendation && !ranking && !automaticSignal && !createsOrder
            && !callsBroker && !mutatesOfficialPortfolio
    }
}

public struct ResearchContextData: Codable, Equatable, Identifiable, Sendable {
    public var operatingModel: OperatingResearchModel? = nil
    public let id: String
    public let membershipId: String
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
    public let comparisons: [ResearchContextComparison]
    public let createdAt: String
    public let currentness: ResearchContextCurrentness
    public let safety: ResearchContextSafety
}

public enum ResearchContextDraftError: Error, Equatable, Sendable {
    case invalid([String])
}

public struct ResearchContextEnvelope: Codable, Equatable, Sendable {
    public static let schemaVersionV3 = "2026-08-13.research-context.v3"

    public let schemaVersion: String
    public let generatedAt: String
    public let status: ResearchContextStatus
    public let membershipId: String
    public let requestedActorId: String
    public let requestedSymbol: String?
    public let metadata: FactMetadata
    public let data: ResearchContextData?
    public let peerSourceIssues: [ResearchPeerSourceIssue]?
    public let peerFactSourceIssues: [ResearchPeerFactSourceIssue]?
    public let contentHash: String?
    public let history: [ResearchContextHistoryEntry]
    public let historyHasMore: Bool
    public let changeSummary: ResearchContextChangeSummary?
    public let message: String

    public func validate(
        expected membership: CandidateMembershipData,
        now: Date = Date()
    ) throws {
        var errors: [String] = []
        metadata.validateForDisplay(label: "research context", errors: &errors)
        if schemaVersion != Self.schemaVersionV3 || !isParseableDateTime(generatedAt) {
            errors.append("research context envelope version or generatedAt is invalid")
        }
        if membershipId != membership.id || requestedActorId != membership.actorId {
            errors.append("research context envelope does not match current actor membership")
        }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("research context message is required")
        }
        if let peerSourceIssues {
            let ids = peerSourceIssues.map(\.peerId)
            if peerSourceIssues.count > 5 || Set(ids).count != ids.count
                || peerSourceIssues.contains(where: { issue in
                    !researchDocumentIsPositiveIntegerString(issue.peerId)
                        || SecuritySymbol.parseHongKongAlias(issue.symbol)?.canonical != issue.symbol
                        || !(issue.status == "stale" && issue.reason == "material_changed"
                            || issue.status == "unavailable" && issue.reason == "original_unavailable")
                        || data?.peers.contains(where: { peer in
                            peer.id == issue.peerId && peer.symbol == issue.symbol
                        }) != true
                }) { errors.append("peer source issues do not match saved peers") }
        }
        if let peerFactSourceIssues {
            let ids = peerFactSourceIssues.map(\.factId)
            if peerFactSourceIssues.count > 100 || Set(ids).count != ids.count
                || peerFactSourceIssues.contains(where: { issue in
                    !researchDocumentIsPositiveIntegerString(issue.factId)
                        || SecuritySymbol.parseHongKongAlias(issue.symbol)?.canonical != issue.symbol
                        || !(issue.status == "stale" && issue.reason == "material_changed"
                            || issue.status == "unavailable" && issue.reason == "original_unavailable")
                        || data?.peerFacts.contains(where: {
                            $0.id == issue.factId && $0.symbol == issue.symbol
                        }) != true
                }) { errors.append("peer fact source issues do not match saved facts") }
        }
        switch status {
        case .available:
            guard let data else {
                errors.append("available research context requires data")
                try throwIfNeeded(errors)
                return
            }
            if let contentHash, !contentHash.isFrozenSHA256 {
                errors.append("research context content hash is invalid")
            }
            if requestedSymbol != membership.symbol
                || metadata.freshness != "fresh"
                || metadata.provenance != "research_only"
                || metadata.authority != "research_evidence"
                || metadata.stale || metadata.missing || metadata.conflict || metadata.fixture {
                errors.append("available research context metadata is not fresh research-only evidence")
            }
            validate(data, expected: membership, now: now, errors: &errors)
        case .notFound:
            if data != nil || contentHash != nil || metadata.freshness != "missing" || !metadata.missing {
                errors.append("missing research context must be fact-free")
            }
        case .unavailable:
            if data != nil || contentHash != nil || metadata.freshness != "unavailable" {
                errors.append("unavailable research context must be fact-free")
            }
        }
        validateResearchContextHistory(
            history,
            hasMore: historyHasMore,
            changeSummary: changeSummary,
            current: data,
            status: status,
            errors: &errors
        )
        try throwIfNeeded(errors)
    }

    private func validate(
        _ data: ResearchContextData,
        expected membership: CandidateMembershipData,
        now: Date,
        errors: inout [String]
    ) {
        if !researchDocumentIsPositiveIntegerString(data.id)
            || data.membershipId != membership.id
            || data.membershipVersion != membership.version
            || data.selectedSymbol != membership.symbol
            || !isBoundedResearchContextString(data.industry, max: 200)
            || data.currentness.status != "current"
            || !data.currentness.invalidatedBy.isEmpty
            || !data.safety.isAdvisoryOnly {
            errors.append("research context identity, currentness, or safety is invalid")
        }
        if !validTimeline(asOf: data.asOf, cutoffAt: data.cutoffAt, validUntil: data.validUntil)
            || researchContextDate(data.validUntil).map({ $0 > now }) != true
            || !isParseableDateTime(data.createdAt) {
            errors.append("research context timeline is invalid")
        }
        if data.selectedFacts.count > 100 || data.peerFacts.count > 100
            || data.peers.count > 5 || data.operatingKpis.count > 100
            || data.macroDrivers.count > 100 || data.industryDrivers.count > 100
            || data.operatingModel == nil && data.selectedFacts.count + data.peerFacts.count
                + data.peers.count + data.operatingKpis.count
                + data.macroDrivers.count + data.industryDrivers.count == 0 {
            errors.append("research context requires bounded cited facts or drivers")
        }
        let selectedIds = Set(data.selectedFacts.map(\.id))
        let peerIds = Set(data.peerFacts.map(\.id))
        if selectedIds.count != data.selectedFacts.count || peerIds.count != data.peerFacts.count {
            errors.append("research context fact ids must be unique")
        }
        for fact in data.selectedFacts {
            validate(fact, expectedSymbol: membership.symbol, cutoffAt: data.cutoffAt, now: now, peer: false, errors: &errors)
        }
        for fact in data.peerFacts {
            validate(fact, expectedSymbol: membership.symbol, cutoffAt: data.cutoffAt, now: now, peer: true, errors: &errors)
        }
        let peerSymbols = Set(data.peers.map(\.symbol))
        if peerSymbols.count != data.peers.count { errors.append("research context peer symbols must be unique") }
        for peer in data.peers {
            if !researchDocumentIsPositiveIntegerString(peer.id) || peer.selectedSymbol != membership.symbol
                || SecuritySymbol.parseHongKongAlias(peer.symbol)?.canonical != peer.symbol || peer.symbol == membership.symbol
                || !isBoundedResearchContextString(peer.name, max: 200)
                || !["included", "excluded"].contains(peer.status)
                || !isBoundedResearchContextString(peer.reason, max: 1_000)
                || !validTimeline(asOf: peer.asOf, cutoffAt: peer.cutoffAt, validUntil: peer.validUntil)
                || researchContextDate(peer.validUntil).map({ $0 > now }) != true {
                errors.append("research context peer is invalid")
            }
            validate(peer.citation, errors: &errors)
            if let sourceMember = peer.citation.sourceMembership,
               sourceMember.symbol != peer.symbol {
                errors.append("peer original is bound to another company")
            }
            if case .savedMaterial(let source) = peer.citation,
               (peer.provenance.sourceType != source.sourceType
                || peer.provenance.sourceVersion != source.sourceVersion
                || peer.provenance.classification != (source.sourceType == "issuer_public_html"
                    ? "authorized_public" : "research_only")) {
                errors.append("research context peer source differs from provenance")
            }
            validate(peer.provenance, errors: &errors)
        }
        for kpi in data.operatingKpis {
            if !researchDocumentIsPositiveIntegerString(kpi.id) || kpi.selectedSymbol != membership.symbol
                || !["operating", "price"].contains(kpi.category)
                || !isBoundedResearchContextString(kpi.metric, max: 200)
                || ResearchFundamentalCalendarDate.date(from: kpi.periodStart, calendar: Calendar(identifier: .gregorian)) == nil
                || ResearchFundamentalCalendarDate.date(from: kpi.periodEnd, calendar: Calendar(identifier: .gregorian)) == nil
                || kpi.periodStart >= kpi.periodEnd || !["reported", "explicit_unknown"].contains(kpi.valueStatus)
                || (kpi.valueStatus == "explicit_unknown") != (kpi.value == nil)
                || kpi.value.map(isCanonicalResearchContextDecimal) == false
                || !isBoundedResearchContextString(kpi.unit, max: 100)
                || !["comparable", "not_comparable"].contains(kpi.comparability)
                || (kpi.comparability == "comparable") != (kpi.comparabilityReason == nil)
                || !validTimeline(asOf: kpi.asOf, cutoffAt: kpi.cutoffAt, validUntil: kpi.validUntil)
                || researchContextDate(kpi.validUntil).map({ $0 > now }) != true {
                errors.append("research operating KPI is invalid")
            }
            validate(kpi.citation, errors: &errors)
            validate(kpi.provenance, errors: &errors)
        }
        for driver in data.macroDrivers {
            validate(driver, kind: "macro", expectedSymbol: membership.symbol, cutoffAt: data.cutoffAt, now: now, errors: &errors)
        }
        for driver in data.industryDrivers {
            validate(driver, kind: "industry", expectedSymbol: membership.symbol, cutoffAt: data.cutoffAt, now: now, errors: &errors)
        }
        let currentComparisons = buildResearchContextComparisons(
            selectedFacts: data.selectedFacts, peerFacts: data.peerFacts
        )
        let retainedComparisons = buildResearchContextComparisons(
            selectedFacts: data.selectedFacts, peerFacts: data.peerFacts,
            allowLegacyPeriodless: true
        )
        if currentComparisons != data.comparisons && retainedComparisons != data.comparisons {
            errors.append("research context comparisons are not deterministic for the supplied facts")
        }
        if data.unknowns.count > 100 || data.unknowns.contains(where: {
            !isBoundedResearchContextString($0, max: 500)
        }) {
            errors.append("research context unknowns must be bounded non-empty strings")
        }
        validate(data.provenance, errors: &errors)
    }

    private func validate(
        _ fact: ResearchContextNumericFact,
        expectedSymbol: String,
        cutoffAt: String,
        now: Date,
        peer: Bool,
        errors: inout [String]
    ) {
        if !researchDocumentIsPositiveIntegerString(fact.id)
            || fact.selectedSymbol != expectedSymbol
            || SecuritySymbol.parseHongKongAlias(fact.symbol)?.canonical != fact.symbol
            || peer == (fact.symbol == expectedSymbol)
            || !isBoundedResearchContextString(fact.metric, max: 200)
            || !isBoundedResearchContextString(fact.unit, max: 100)
            || fact.currency.map(isResearchContextCurrency) == false
            || researchContextDate(fact.cutoffAt).map({ cutoff in
                researchContextDate(cutoffAt).map { cutoff > $0 } ?? true
            }) != false
            || !validTimeline(asOf: fact.asOf, cutoffAt: fact.cutoffAt, validUntil: fact.validUntil)
            || researchContextDate(fact.validUntil).map({ $0 > now }) != true
            || fact.value.map(isCanonicalResearchContextDecimal) == false {
            errors.append("research context numeric fact is invalid")
        }
        if fact.periodStart != nil && fact.periodEnd == nil
            || fact.periodEnd.map({ end in
                ResearchFundamentalCalendarDate.date(from: end, calendar: Calendar(identifier: .gregorian)) == nil
                    || researchContextDate(fact.asOf).map({ asOf in
                        (ResearchFundamentalCalendarDate.date(from: end, calendar: Calendar(identifier: .gregorian)) ?? .distantFuture) > asOf
                    }) != false
            }) == true
            || fact.periodStart.map({ start in
                ResearchFundamentalCalendarDate.date(from: start, calendar: Calendar(identifier: .gregorian)) == nil
                    || fact.periodEnd.map({ start >= $0 }) != false
            }) == true {
            errors.append("research context measurement period is invalid")
        }
        validate(fact.citation, errors: &errors)
        if peer ? fact.citation.sourceMembership.map({ $0.symbol != fact.symbol }) == true
            : fact.citation.sourceMembership != nil {
            errors.append("numeric fact original does not bind its company")
        }
        if !peer, case .savedMaterial = fact.citation {
            errors.append("selected company fact requires its PDF citation")
        }
        if peer, case .savedMaterial(let source) = fact.citation,
           (fact.provenance.sourceType != source.sourceType
            || fact.provenance.sourceVersion != source.sourceVersion
            || fact.provenance.classification != (source.sourceType == "issuer_public_html"
                ? "authorized_public" : "research_only")) {
            errors.append("peer numeric fact provenance differs from its saved original")
        }
        validate(fact.provenance, errors: &errors)
    }

    private func validate(
        _ driver: ResearchContextDriver,
        kind: String,
        expectedSymbol: String,
        cutoffAt: String,
        now: Date,
        errors: inout [String]
    ) {
        if !researchDocumentIsPositiveIntegerString(driver.id)
            || driver.selectedSymbol != expectedSymbol || driver.kind != kind
            || !(kind == "industry"
                ? ["supply", "demand", "pricing", "competition", "policy", "cycle"]
                : ["growth", "inflation", "rates", "fx", "commodities", "policy"]).contains(driver.dimension)
            || !["supportive", "adverse", "mixed", "unknown"].contains(driver.impact)
            || !isBoundedResearchContextString(driver.statement, max: 4_000)
            || !isBoundedResearchContextString(driver.thesisRelevance, max: 1_000)
            || researchContextDate(driver.cutoffAt).map({ cutoff in
                researchContextDate(cutoffAt).map { cutoff > $0 } ?? true
            }) != false
            || !validTimeline(asOf: driver.asOf, cutoffAt: driver.cutoffAt, validUntil: driver.validUntil)
            || researchContextDate(driver.validUntil).map({ $0 > now }) != true {
            errors.append("research context driver is invalid")
        }
        validate(driver.citation, errors: &errors)
        validate(driver.provenance, errors: &errors)
    }

    private func validate(_ citation: ResearchContextCitation, errors: inout [String]) {
        if !researchDocumentIsPositiveIntegerString(citation.documentId)
            || citation.pageNumber <= 0
            || !researchDocumentIsSha256(citation.pageTextSha256)
            || !isBoundedResearchContextString(citation.sourceType, max: 200)
            || !isBoundedResearchContextString(citation.sourceVersion, max: 200)
            || citation.sourceUrl.map(isHTTPResearchContextURL) == false {
            errors.append("research context citation is invalid")
        }
        validate(citation.sourceMembership, errors: &errors)
    }

    private func validate(_ citation: ResearchPeerCitation, errors: inout [String]) {
        switch citation {
        case .pdf(let page): validate(page, errors: &errors)
        case .savedMaterial(let source):
            validate(source.sourceMembership, errors: &errors)
            if source.kind != "saved_material"
                || !researchDocumentIsPositiveIntegerString(source.materialId)
                || source.materialRevision <= 0
                || !researchDocumentIsSha256(source.contentFingerprint)
                || !isBoundedResearchContextString(source.sourceVersion, max: 200)
                || source.sourceUrl.map(isHTTPResearchContextURL) == false {
                errors.append("saved peer material identity is invalid")
            }
            if source.sourceType == "issuer_public_html" {
                if source.sourceUrl == nil || source.snapshotCitation?.isValid != true
                    || !researchDocumentIsSha256(source.snapshotRawSha256 ?? "")
                    || source.providerOriginal != nil { errors.append("saved HTML peer locator is invalid") }
            } else if source.sourceType == "futu_opend_financial_statement_provider" {
                let original = source.providerOriginal
                if source.sourceUrl != nil || source.snapshotCitation != nil || source.snapshotRawSha256 != nil
                    || original == nil
                    || !researchDocumentIsPositiveIntegerString(original?.captureId ?? "")
                    || !researchDocumentIsPositiveIntegerString(original?.pageId ?? "")
                    || !researchDocumentIsSha256(original?.rawSha256 ?? "")
                    || !researchDocumentIsSha256(original?.reportSha256 ?? "") {
                    errors.append("saved OpenD peer locator is invalid")
                }
            } else { errors.append("saved peer source type is unsupported") }
        }
    }

    private func validate(_ source: ResearchContextSourceMembership?, errors: inout [String]) {
        guard let source else { return }
        if !researchDocumentIsPositiveIntegerString(source.membershipId)
            || source.membershipVersion < 1
            || SecuritySymbol.parseHongKongAlias(source.symbol)?.canonical != source.symbol {
            errors.append("peer source membership identity is invalid")
        }
    }

    private func validate(_ provenance: ResearchContextProvenance, errors: inout [String]) {
        if !isBoundedResearchContextString(provenance.sourceType, max: 200)
            || !isBoundedResearchContextString(provenance.sourceVersion, max: 200)
            || !isParseableDateTime(provenance.capturedAt)
            || !["authorized_public", "user_provided", "research_only"].contains(provenance.classification) {
            errors.append("research context provenance is invalid")
        }
    }

    private func throwIfNeeded(_ errors: [String]) throws {
        if !errors.isEmpty { throw ResearchContextValidationError.invalid(errors) }
    }
}

public enum ResearchContextValidationError: Error, Equatable, Sendable {
    case invalid([String])
}

public enum ResearchContextClientError: Error, Equatable, Sendable {
    case httpStatus(Int)
    case invalidResponse
}

extension ResearchClient {
    public func fetchResearchContext(
        membership: CandidateMembershipData
    ) async throws -> ResearchContextEnvelope {
        let url = candidateMembershipsURL(includeArchived: nil)
            .appending(path: membership.id)
            .appending(path: "research-context")
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        applyAuth(to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ResearchContextClientError.invalidResponse
        }
        guard [200, 404, 503].contains(http.statusCode) else {
            throw ResearchContextClientError.httpStatus(http.statusCode)
        }
        let envelope: ResearchContextEnvelope
        do {
            try validateResearchContextRawShape(data)
            envelope = try JSONDecoder().decode(ResearchContextEnvelope.self, from: data)
            try envelope.validate(expected: membership)
        } catch {
            if http.statusCode != 200 {
                throw ResearchContextClientError.httpStatus(http.statusCode)
            }
            throw ResearchContextClientError.invalidResponse
        }
        switch (http.statusCode, envelope.status) {
        case (200, .available), (404, .notFound), (503, .unavailable):
            return envelope
        default:
            if http.statusCode != 200 {
                throw ResearchContextClientError.httpStatus(http.statusCode)
            }
            throw ResearchContextClientError.invalidResponse
        }
    }
}

private func validateResearchContextRawShape(_ data: Data) throws {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          researchContextHasRequiredKeys(root, [
            "schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId",
            "requestedSymbol", "metadata", "data", "history", "historyHasMore",
            "changeSummary", "message"
          ]),
          researchContextHistoryHasRequiredShape(root) else {
        throw ResearchContextClientError.invalidResponse
    }
    if root["data"] is NSNull { return }
    guard let context = root["data"] as? [String: Any],
          researchContextHasRequiredKeys(context, [
            "id", "membershipId", "membershipVersion", "selectedSymbol", "industry",
            "selectedFacts", "peerFacts", "peers", "operatingKpis", "macroDrivers", "industryDrivers", "unknowns",
            "provenance", "asOf", "cutoffAt", "validUntil", "comparisons", "createdAt",
            "currentness", "safety"
          ]),
          researchContextFactArrayHasRequiredShape(context["selectedFacts"]),
          researchContextFactArrayHasRequiredShape(context["peerFacts"], allowSaved: true),
          context["peers"] is [Any],
          context["operatingKpis"] is [Any],
          researchContextDriverArrayHasRequiredShape(context["macroDrivers"]),
          researchContextDriverArrayHasRequiredShape(context["industryDrivers"]),
          researchContextComparisonArrayHasRequiredShape(context["comparisons"]) else {
        throw ResearchContextClientError.invalidResponse
    }
}

private func researchContextFactArrayHasRequiredShape(_ value: Any?, allowSaved: Bool = false) -> Bool {
    guard let facts = value as? [Any] else { return false }
    return facts.allSatisfy { value in
        guard let fact = value as? [String: Any],
              researchContextHasRequiredKeys(fact, [
                "id", "selectedSymbol", "symbol", "metric", "value", "unit", "currency",
                "asOf", "cutoffAt", "validUntil", "citation", "provenance"
              ]) else { return false }
        if allowSaved, let citation = fact["citation"] as? [String: Any],
           citation["kind"] as? String == "saved_material" {
            return researchContextHasRequiredKeys(citation, ["kind", "materialId",
                "materialRevision", "contentFingerprint", "sourceType", "sourceUrl", "sourceVersion"])
        }
        return researchContextCitationHasRequiredShape(fact["citation"])
    }
}

private func researchContextDriverArrayHasRequiredShape(_ value: Any?) -> Bool {
    guard let drivers = value as? [Any] else { return false }
    return drivers.allSatisfy { value in
        guard let driver = value as? [String: Any],
              researchContextHasRequiredKeys(driver, [
                "id", "selectedSymbol", "kind", "statement", "asOf", "cutoffAt",
                "validUntil", "citation", "provenance"
              ]) else { return false }
        return researchContextCitationHasRequiredShape(driver["citation"])
    }
}

private func researchContextComparisonArrayHasRequiredShape(_ value: Any?) -> Bool {
    guard let comparisons = value as? [Any] else { return false }
    return comparisons.allSatisfy { value in
        guard let comparison = value as? [String: Any] else { return false }
        return researchContextHasRequiredKeys(comparison, [
            "peerSymbol", "metric", "selectedFactId", "peerFactId", "unit", "currency",
            "status", "selectedValue", "peerValue", "delta", "reason", "calculationVersion"
        ])
    }
}

private func researchContextCitationHasRequiredShape(_ value: Any?) -> Bool {
    guard let citation = value as? [String: Any] else { return false }
    return researchContextHasRequiredKeys(citation, [
        "documentId", "pageNumber", "pageTextSha256", "sourceType", "sourceUrl", "sourceVersion"
    ])
}

private func researchContextHasRequiredKeys(
    _ value: [String: Any],
    _ required: Set<String>
) -> Bool {
    required.isSubset(of: Set(value.keys))
}

private func buildResearchContextComparisons(
    selectedFacts: [ResearchContextNumericFact],
    peerFacts: [ResearchContextNumericFact],
    allowLegacyPeriodless: Bool = false
) -> [ResearchContextComparison] {
    peerFacts.map { peer in
        let sameMetric = selectedFacts.filter { $0.metric == peer.metric }
        let selected = peer.periodEnd == nil ? sameMetric : sameMetric.filter {
            $0.periodEnd == peer.periodEnd && $0.periodStart == peer.periodStart
        }
        guard selected.count == 1, let fact = selected.first else {
            return researchContextNotComparable(
                peer: peer,
                selected: selected.first ?? sameMetric.first,
                reason: selected.isEmpty
                    ? (sameMetric.isEmpty ? "selected fact is missing" : "matching measurement period is missing")
                    : "selected fact is ambiguous"
            )
        }
        guard fact.selectedSymbol == peer.selectedSymbol else {
            return researchContextNotComparable(
                peer: peer,
                selected: fact,
                reason: "symbol or cutoff is not comparable"
            )
        }
        if fact.periodEnd == nil || peer.periodEnd == nil {
            guard allowLegacyPeriodless else {
                return researchContextNotComparable(peer: peer, selected: fact,
                    reason: "measurement period is not disclosed")
            }
            guard fact.periodEnd == peer.periodEnd, fact.cutoffAt == peer.cutoffAt else {
                return researchContextNotComparable(peer: peer, selected: fact,
                    reason: fact.periodEnd == nil && peer.periodEnd == nil
                        ? "symbol or cutoff is not comparable" : "measurement period or cutoff is not comparable")
            }
        } else if fact.periodStart != peer.periodStart || fact.periodEnd != peer.periodEnd {
            return researchContextNotComparable(peer: peer, selected: fact,
                reason: "measurement period is not comparable")
        }
        guard fact.unit == peer.unit, fact.currency == peer.currency else {
            return researchContextNotComparable(
                peer: peer,
                selected: fact,
                reason: "unit or currency is not comparable"
            )
        }
        guard let selectedValue = fact.value, let peerValue = peer.value else {
            return researchContextNotComparable(
                peer: peer,
                selected: fact,
                reason: "unknown value is not calculable"
            )
        }
        return ResearchContextComparison(
            peerSymbol: peer.symbol,
            metric: peer.metric,
            selectedFactId: fact.id,
            peerFactId: peer.id,
            unit: peer.unit,
            currency: peer.currency,
            status: "available",
            selectedValue: selectedValue,
            peerValue: peerValue,
            delta: researchContextDecimalDelta(peerValue, selectedValue),
            reason: nil,
            calculationVersion: "decimal-delta-v1"
        )
    }
}

private func researchContextNotComparable(
    peer: ResearchContextNumericFact,
    selected: ResearchContextNumericFact?,
    reason: String
) -> ResearchContextComparison {
    ResearchContextComparison(
        peerSymbol: peer.symbol,
        metric: peer.metric,
        selectedFactId: selected?.id,
        peerFactId: peer.id,
        unit: peer.unit,
        currency: peer.currency,
        status: "not_comparable",
        selectedValue: selected?.value,
        peerValue: peer.value,
        delta: nil,
        reason: reason,
        calculationVersion: "decimal-delta-v1"
    )
}

private func researchContextDecimalDelta(_ left: String, _ right: String) -> String? {
    guard isCanonicalResearchContextDecimal(left), isCanonicalResearchContextDecimal(right) else {
        return nil
    }
    let scale = max(researchContextFractionLength(left), researchContextFractionLength(right))
    guard let a = researchContextScaledInteger(left, scale: scale),
          let b = researchContextScaledInteger(right, scale: scale) else { return nil }
    let result: (negative: Bool, digits: [Int])
    if a.negative != b.negative {
        result = (a.negative, researchContextAdd(a.digits, b.digits))
    } else {
        switch researchContextCompare(a.digits, b.digits) {
        case 0: result = (false, [0])
        case 1: result = (a.negative, researchContextSubtract(a.digits, b.digits))
        default: result = (!a.negative, researchContextSubtract(b.digits, a.digits))
        }
    }
    return researchContextRender(result.digits, scale: scale, negative: result.negative)
}

private func researchContextFractionLength(_ value: String) -> Int {
    value.split(separator: ".", omittingEmptySubsequences: false).dropFirst().first?.count ?? 0
}

private func researchContextScaledInteger(
    _ value: String,
    scale: Int
) -> (negative: Bool, digits: [Int])? {
    let negative = value.hasPrefix("-")
    let unsigned = negative ? String(value.dropFirst()) : value
    let parts = unsigned.split(separator: ".", omittingEmptySubsequences: false)
    let fraction = parts.count == 2 ? String(parts[1]) : ""
    let raw = String(parts[0]) + fraction + String(repeating: "0", count: scale - fraction.count)
    guard raw.allSatisfy(\.isNumber) else { return nil }
    let digits = raw.compactMap { $0.wholeNumberValue }
    let trimmed = Array(digits.drop(while: { $0 == 0 }))
    let canonical = trimmed.isEmpty ? [0] : trimmed
    return (negative && canonical != [0], canonical)
}

private func researchContextCompare(_ left: [Int], _ right: [Int]) -> Int {
    if left.count != right.count { return left.count > right.count ? 1 : -1 }
    for (a, b) in zip(left, right) where a != b { return a > b ? 1 : -1 }
    return 0
}

private func researchContextAdd(_ left: [Int], _ right: [Int]) -> [Int] {
    var result: [Int] = []
    var carry = 0
    var leftIndex = left.count - 1
    var rightIndex = right.count - 1
    while leftIndex >= 0 || rightIndex >= 0 || carry > 0 {
        let sum = (leftIndex >= 0 ? left[leftIndex] : 0)
            + (rightIndex >= 0 ? right[rightIndex] : 0) + carry
        result.append(sum % 10)
        carry = sum / 10
        leftIndex -= 1
        rightIndex -= 1
    }
    return Array(result.reversed())
}

private func researchContextSubtract(_ left: [Int], _ right: [Int]) -> [Int] {
    var result: [Int] = []
    var borrow = 0
    var rightIndex = right.count - 1
    for leftIndex in stride(from: left.count - 1, through: 0, by: -1) {
        var digit = left[leftIndex] - borrow - (rightIndex >= 0 ? right[rightIndex] : 0)
        if digit < 0 { digit += 10; borrow = 1 } else { borrow = 0 }
        result.append(digit)
        rightIndex -= 1
    }
    let canonical = Array(result.reversed().drop(while: { $0 == 0 }))
    return canonical.isEmpty ? [0] : canonical
}

private func researchContextRender(_ digits: [Int], scale: Int, negative: Bool) -> String {
    var padded = digits
    if padded.count <= scale {
        padded.insert(contentsOf: repeatElement(0, count: scale - padded.count + 1), at: 0)
    }
    let split = padded.count - scale
    let whole = padded[..<split].map(String.init).joined()
    let fraction = scale == 0
        ? ""
        : padded[split...].map(String.init).joined().replacingOccurrences(
            of: #"0+$"#,
            with: "",
            options: .regularExpression
        )
    let unsigned = fraction.isEmpty ? whole : "\(whole).\(fraction)"
    return negative && unsigned != "0" ? "-\(unsigned)" : unsigned
}

private func validTimeline(asOf: String, cutoffAt: String, validUntil: String) -> Bool {
    guard let asOfDate = researchContextDate(asOf),
          let cutoffDate = researchContextDate(cutoffAt),
          let validUntilDate = researchContextDate(validUntil) else { return false }
    return cutoffDate <= asOfDate && validUntilDate > asOfDate
}

func researchContextDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

func isCanonicalResearchContextDecimal(_ value: String) -> Bool {
    value != "-0" && value.range(
        of: #"^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$"#,
        options: .regularExpression
    ) != nil
}

func isResearchContextCurrency(_ value: String) -> Bool {
    value.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil
}

func isBoundedResearchContextString(_ value: String, max: Int) -> Bool {
    !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= max
}

private func isHTTPResearchContextURL(_ value: String) -> Bool {
    guard value.utf16.count <= 2_000,
          let url = URLComponents(string: value),
          let scheme = url.scheme?.lowercased(),
          url.host?.isEmpty == false else { return false }
    return scheme == "http" || scheme == "https"
}
