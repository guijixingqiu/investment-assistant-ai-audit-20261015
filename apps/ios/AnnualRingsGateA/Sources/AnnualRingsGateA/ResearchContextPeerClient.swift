import Foundation

/// An Owner-authored change to one cited peer. The surrounding context is copied
/// from the current version so editing a peer cannot silently erase other facts.
public struct ResearchContextPeerEdit: Equatable, Sendable {
    public let symbol: String
    public let name: String
    public let status: String
    public let reason: String
    public let industry: String
    public let validUntil: Date
    public let replacingSymbol: String?

    public init(symbol: String, name: String, status: String, reason: String,
                industry: String, validUntil: Date, replacingSymbol: String? = nil) {
        self.symbol = symbol
        self.name = name
        self.status = status
        self.reason = reason
        self.industry = industry
        self.validUntil = validUntil
        self.replacingSymbol = replacingSymbol
    }

    public func request(membership: CandidateMembershipData, document: ResearchDocumentData,
                        page: ResearchDocumentPageData, current: ResearchContextData?,
                        idempotencyKey: String, sourceMembership: CandidateMembershipData? = nil,
                        now: Date = Date()) throws -> CreateResearchContextRequest {
        var errors: [String] = []
        let canonical = SecuritySymbol.parseHongKongAlias(symbol)?.canonical
        let peerName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let peerReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let replacedPeer = replacingSymbol.flatMap { old in current?.peers.first { $0.symbol == old } }
        let contextIndustry = current?.industry ?? industry.trimmingCharacters(in: .whitespacesAndNewlines)
        let expires = ISO8601DateFormatter().string(from: validUntil)
        if membership.state != .tracked || canonical == nil || canonical == membership.symbol
            || !isBoundedResearchContextString(peerName, max: 200)
            || !["included", "excluded"].contains(status)
            || !isBoundedResearchContextString(peerReason, max: 1_000)
            || !isBoundedResearchContextString(contextIndustry, max: 200)
            || !isBoundedResearchContextString(idempotencyKey, max: 200) {
            errors.append("peer identity, status, reason, or industry is invalid")
        }
        let sourceMember = sourceMembership ?? membership
        if sourceMembership != nil && (sourceMember.actorId != membership.actorId
            || sourceMember.symbol != canonical || sourceMember.state != .tracked) {
            errors.append("peer original must belong to the selected same-Owner peer")
        }
        if document.membershipId != sourceMember.id || document.membershipVersionAtImport != sourceMember.version
            || document.symbol != sourceMember.symbol || document.sourceState != "available"
            || document.sourceClassification != "owner_declared_official"
            || document.rightsStatus != "user_provided"
            || page.documentId != document.id || page.pageNumber < 1 || page.pageNumber > document.pageCount
            || page.normalizedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !researchDocumentIsSha256(page.pageTextSha256)
            || researchDocumentSha256(Data(page.normalizedText.utf8)) != page.pageTextSha256 {
            errors.append("peer citation does not match the current saved PDF page")
        }
        guard let published = researchContextDate(document.publishedAt),
              let captured = researchContextDate(document.importedAt),
              let expiry = researchContextDate(expires) else {
            throw ResearchContextDraftError.invalid(errors + ["peer source timeline is invalid"])
        }
        if published > now || captured > now || expiry <= now {
            errors.append("peer source must already exist and remain valid")
        }
        if let current,
           (current.membershipId != membership.id || current.membershipVersion != membership.version
            || current.selectedSymbol != membership.symbol || current.currentness.status != "current"
            || !current.currentness.invalidatedBy.isEmpty || !current.safety.isAdvisoryOnly
            || researchContextDate(current.validUntil).map({ $0 > now }) != true) {
            errors.append("existing context is no longer bound to this membership")
        }
        if replacingSymbol != nil && replacedPeer == nil {
            errors.append("the peer being edited is no longer in this context")
        }
        if let canonical, let replacedPeer, replacedPeer.symbol != canonical,
           current?.peers.contains(where: { $0.symbol == canonical }) == true {
            errors.append("replacement would duplicate another peer")
        }
        let remainingPeers = current?.peers.filter { $0.symbol != replacedPeer?.symbol } ?? []
        if let canonical, !remainingPeers.contains(where: { $0.symbol == canonical }),
           remainingPeers.count >= 5 {
            errors.append("at most five cited peer records can be kept")
        }
        if !errors.isEmpty { throw ResearchContextDraftError.invalid(errors) }
        let citation = ResearchContextCitation(documentId: document.id, pageNumber: page.pageNumber,
            pageTextSha256: page.pageTextSha256, sourceType: "owner_provided_pdf", sourceUrl: nil,
            sourceVersion: document.sourceVersion,
            sourceMembership: sourceMembership.map(ResearchContextSourceMembership.init))
        let provenance = ResearchContextProvenance(sourceType: "owner_provided_pdf",
            sourceVersion: document.sourceVersion, capturedAt: document.importedAt,
            classification: "user_provided")
        return try finishRequest(membership: membership, citation: .pdf(citation), provenance: provenance,
            sourceAt: document.publishedAt, current: current, idempotencyKey: idempotencyKey, now: now)
    }

    public func request(membership: CandidateMembershipData, material: ResearchMaterialData,
                        providerPageId: String? = nil, current: ResearchContextData?,
                        idempotencyKey: String, sourceMembership: CandidateMembershipData? = nil,
                        now: Date = Date()) throws -> CreateResearchContextRequest {
        let sourceMember = sourceMembership ?? membership
        guard sourceMembership == nil || sourceMember.actorId == membership.actorId
                && sourceMember.symbol == SecuritySymbol.parseHongKongAlias(symbol)?.canonical
                && sourceMember.state == .tracked,
              material.validates(expected: sourceMember), material.symbol == sourceMember.symbol,
              material.market == sourceMember.market, material.code == sourceMember.code,
              material.revisionState == "current",
              material.freshness == "fresh", researchContextDate(material.validUntil).map({ $0 > now }) == true,
              material.verificationStatus != "rejected", material.verificationStatus != "conflict" else {
            throw ResearchContextDraftError.invalid(["saved peer material is no longer current"])
        }
        let citation: ResearchPeerMaterialCitation
        let sourceAt: String
        let classification: String
        if material.sourceType == "issuer_public_html" {
            guard material.rightsStatus == "authorized_public", let published = material.publishedAt,
                  let excerpt = material.snapshotCitation, excerpt.isValid,
                  let original = material.snapshotOriginal, original.isValid,
                  original.responseUrl == material.sourceUrl else {
                throw ResearchContextDraftError.invalid(["saved HTML peer original is unavailable"])
            }
            citation = .init(kind: "saved_material", materialId: material.id, materialRevision: material.revision,
                contentFingerprint: material.contentFingerprint, sourceType: material.sourceType,
                sourceUrl: material.sourceUrl, sourceVersion: material.sourceVersion,
                snapshotCitation: excerpt, snapshotRawSha256: original.rawSha256, providerOriginal: nil,
                sourceMembership: sourceMembership.map(ResearchContextSourceMembership.init))
            sourceAt = published; classification = "authorized_public"
        } else if material.sourceType == "futu_opend_financial_statement_provider" {
            guard material.claimType == "third_party_statement", material.verificationStatus == "unverified",
                  material.rightsStatus == "user_provided", material.publishedAt == nil,
                  let source = material.futuFinancialSource, source.validates(sourceMember),
                  let page = source.pages.first(where: { $0.pageId == providerPageId }) else {
                throw ResearchContextDraftError.invalid(["saved OpenD peer original is unavailable"])
            }
            citation = .init(kind: "saved_material", materialId: material.id, materialRevision: material.revision,
                contentFingerprint: material.contentFingerprint, sourceType: material.sourceType,
                sourceUrl: nil, sourceVersion: material.sourceVersion,
                snapshotCitation: nil, snapshotRawSha256: nil,
                providerOriginal: .init(captureId: source.captureId, pageId: page.pageId,
                    rawSha256: page.rawSha256, reportSha256: page.reportSha256),
                sourceMembership: sourceMembership.map(ResearchContextSourceMembership.init))
            sourceAt = material.capturedAt; classification = "research_only"
        } else { throw ResearchContextDraftError.invalid(["peer material source type is unsupported"]) }
        return try finishRequest(membership: membership, citation: .savedMaterial(citation),
            provenance: .init(sourceType: material.sourceType, sourceVersion: material.sourceVersion,
                capturedAt: material.capturedAt, classification: classification), sourceAt: sourceAt,
            current: current, idempotencyKey: idempotencyKey, now: now)
    }

    private func finishRequest(membership: CandidateMembershipData, citation: ResearchPeerCitation,
                               provenance: ResearchContextProvenance, sourceAt: String,
                               current: ResearchContextData?, idempotencyKey: String,
                               now: Date) throws -> CreateResearchContextRequest {
        let canonical = SecuritySymbol.parseHongKongAlias(symbol)?.canonical
        let peerName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let peerReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let contextIndustry = current?.industry ?? industry.trimmingCharacters(in: .whitespacesAndNewlines)
        let replacedPeer = replacingSymbol.flatMap { old in current?.peers.first { $0.symbol == old } }
        let expires = ISO8601DateFormatter().string(from: validUntil)
        guard membership.state == .tracked, let canonical, canonical != membership.symbol,
              isBoundedResearchContextString(peerName, max: 200),
              ["included", "excluded"].contains(status),
              isBoundedResearchContextString(peerReason, max: 1_000),
              isBoundedResearchContextString(contextIndustry, max: 200),
              isBoundedResearchContextString(idempotencyKey, max: 200),
              let published = researchContextDate(sourceAt), published <= now,
              let captured = researchContextDate(provenance.capturedAt), captured <= now,
              let expiry = researchContextDate(expires), expiry > now,
              replacingSymbol == nil || replacedPeer != nil,
              current == nil || current?.membershipId == membership.id
                  && current?.membershipVersion == membership.version
                  && current?.selectedSymbol == membership.symbol
                  && current?.currentness.status == "current"
                  && current?.safety.isAdvisoryOnly == true
                  && researchContextDate(current?.validUntil ?? "").map({ $0 > now }) == true else {
            throw ResearchContextDraftError.invalid(["peer edit identity, source, or timeline is invalid"])
        }
        let remainingPeers = current?.peers.filter { $0.symbol != replacedPeer?.symbol } ?? []
        if remainingPeers.contains(where: { $0.symbol == canonical && $0.id != replacedPeer?.id })
            || !remainingPeers.contains(where: { $0.symbol == canonical }) && remainingPeers.count >= 5 {
            throw ResearchContextDraftError.invalid(["peer list would duplicate a company or exceed five"])
        }
        let id = replacedPeer?.id ?? current?.peers.first(where: { $0.symbol == canonical })?.id
            ?? String((current?.peers.compactMap { Int($0.id) }.max() ?? 0) + 1)
        let peer = ResearchContextPeer(id: id, selectedSymbol: membership.symbol, symbol: canonical,
            name: peerName, status: status, reason: peerReason, asOf: sourceAt,
            cutoffAt: sourceAt, validUntil: expires, citation: citation,
            provenance: provenance)
        var peers = remainingPeers.filter { $0.symbol != canonical }
        peers.append(peer)
        peers.sort { $0.symbol < $1.symbol }
        let contextAsOf = current.map {
            (researchContextDate($0.asOf) ?? .distantPast) >= published ? $0.asOf : sourceAt
        } ?? sourceAt
        let contextCutoff = current.map {
            (researchContextDate($0.cutoffAt) ?? .distantPast) >= published ? $0.cutoffAt : sourceAt
        } ?? sourceAt
        let contextValidUntil = current.map {
            (researchContextDate($0.validUntil) ?? .distantFuture) <= expiry ? $0.validUntil : expires
        } ?? expires
        return CreateResearchContextRequest(operatingModel: current?.operatingModel,
            baseContextId: current?.id, membershipVersion: membership.version,
            selectedSymbol: membership.symbol, industry: contextIndustry,
            selectedFacts: current?.selectedFacts ?? [], peerFacts: current?.peerFacts ?? [],
            peers: peers, operatingKpis: current?.operatingKpis ?? [],
            macroDrivers: current?.macroDrivers ?? [], industryDrivers: current?.industryDrivers ?? [],
            unknowns: current?.unknowns ?? [], provenance: current?.provenance ?? provenance,
            asOf: contextAsOf, cutoffAt: contextCutoff, validUntil: contextValidUntil,
            idempotencyKey: idempotencyKey)
    }
}

/// A manually entered numeric observation from an exact, already saved original.
/// Period and entity scope belong in the metric; the comparison only uses exact
/// metric, unit, currency and cutoff matches already enforced by the context.
public struct ResearchContextPeerFactEdit: Equatable, Sendable {
    public let peerSymbol: String
    public let metric: String
    public let value: String
    public let unit: String
    public let currency: String
    public let periodStart: Date?
    public let periodEnd: Date
    public let validUntil: Date

    public init(peerSymbol: String, metric: String, value: String, unit: String,
                currency: String, periodStart: Date?, periodEnd: Date, validUntil: Date) {
        self.peerSymbol = peerSymbol; self.metric = metric; self.value = value
        self.unit = unit; self.currency = currency; self.periodStart = periodStart
        self.periodEnd = periodEnd; self.validUntil = validUntil
    }

    public func request(membership: CandidateMembershipData, sourceMembership: CandidateMembershipData,
                        citation: ResearchPeerCitation, provenance: ResearchContextProvenance,
                        sourceAt: String, current: ResearchContextData,
                        idempotencyKey: String, now: Date = Date()) throws -> CreateResearchContextRequest {
        let canonical = SecuritySymbol.parseHongKongAlias(peerSymbol)?.canonical
        let metric = metric.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let unit = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        let currency = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let calendar = Calendar(identifier: .gregorian)
        let periodStart = periodStart.flatMap { ResearchFundamentalCalendarDate.string(from: $0, calendar: calendar) }
        let periodEnd = ResearchFundamentalCalendarDate.string(from: periodEnd, calendar: calendar)
        let expires = ISO8601DateFormatter().string(from: validUntil)
        guard membership.state == .tracked, sourceMembership.state == .tracked,
              membership.actorId == sourceMembership.actorId,
              let canonical, canonical != membership.symbol,
              sourceMembership.id == membership.id || sourceMembership.symbol == canonical,
              citation.sourceMembership == (sourceMembership.id == membership.id
                  ? nil : ResearchContextSourceMembership(sourceMembership)),
              current.membershipId == membership.id, current.membershipVersion == membership.version,
              current.selectedSymbol == membership.symbol, current.currentness.status == "current",
              current.safety.isAdvisoryOnly,
              current.peers.contains(where: { $0.symbol == canonical && $0.status == "included" }),
              isBoundedResearchContextString(metric, max: 200),
              isBoundedResearchContextString(unit, max: 100),
              value.isEmpty || isCanonicalResearchContextDecimal(value),
              currency.isEmpty || isResearchContextCurrency(currency),
              isBoundedResearchContextString(idempotencyKey, max: 200),
              let published = researchContextDate(sourceAt), published <= now,
              let periodEnd, researchContextDate("\(periodEnd)T00:00:00Z").map({ $0 <= published }) == true,
              periodStart == nil || periodStart! < periodEnd,
              let captured = researchContextDate(provenance.capturedAt), captured <= now,
              let expiry = researchContextDate(expires), expiry > now,
              researchContextDate(current.validUntil).map({ $0 > now }) == true else {
            throw ResearchContextDraftError.invalid(["peer fact, original, or current context identity is invalid"])
        }
        let id = current.peerFacts.first(where: { $0.symbol == canonical && $0.metric == metric
            && $0.periodStart == periodStart && $0.periodEnd == periodEnd })?.id
            ?? String((current.selectedFacts.map(\.id) + current.peerFacts.map(\.id))
                .compactMap(Int.init).max().map { $0 + 1 } ?? 1)
        let fact = ResearchContextNumericFact(id: id, selectedSymbol: membership.symbol,
            symbol: canonical, metric: metric, value: value.isEmpty ? nil : value,
            unit: unit, currency: currency.isEmpty ? nil : currency,
            periodStart: periodStart, periodEnd: periodEnd,
            asOf: sourceAt, cutoffAt: sourceAt, validUntil: expires,
            citation: citation, provenance: provenance)
        var facts = current.peerFacts.filter { $0.id != id && !($0.symbol == canonical
            && $0.metric == metric && $0.periodStart == periodStart && $0.periodEnd == periodEnd) }
        facts.append(fact)
        facts.sort { Int($0.id)! < Int($1.id)! }
        let contextAsOf = published > (researchContextDate(current.asOf) ?? .distantPast) ? sourceAt : current.asOf
        let contextCutoff = published > (researchContextDate(current.cutoffAt) ?? .distantPast) ? sourceAt : current.cutoffAt
        let contextValidUntil = expiry < (researchContextDate(current.validUntil) ?? .distantFuture)
            ? expires : current.validUntil
        return CreateResearchContextRequest(operatingModel: current.operatingModel,
            baseContextId: current.id, membershipVersion: membership.version,
            selectedSymbol: membership.symbol, industry: current.industry,
            selectedFacts: current.selectedFacts, peerFacts: facts, peers: current.peers,
            operatingKpis: current.operatingKpis, macroDrivers: current.macroDrivers,
            industryDrivers: current.industryDrivers, unknowns: current.unknowns,
            provenance: current.provenance, asOf: contextAsOf, cutoffAt: contextCutoff,
            validUntil: contextValidUntil, idempotencyKey: idempotencyKey)
    }
}
