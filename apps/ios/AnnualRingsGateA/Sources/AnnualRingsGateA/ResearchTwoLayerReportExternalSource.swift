import Foundation

extension FrozenResearchEvidencePack {
    public func exactReopenableMaterial(
        for fact: TwoLayerReportFact,
        evidenceId: String
    ) -> ResearchMaterialData? {
        guard fact.sourceKind == "material",
              fact.evidenceIds.contains(evidenceId) else { return nil }
        let matches = items.filter {
            $0.evidenceId == evidenceId
                && $0.citation != nil
                && fact.matches($0)
        }
        return matches.count == 1 ? matches[0] : nil
    }

    public func exactExternalSourceURL(
        for fact: TwoLayerReportFact,
        events: [ResearchAnnouncementEventData]
    ) -> URL? {
        let materials: [ResearchMaterialData]
        switch fact.sourceKind {
        case "material":
            let evidenceIds = Set(fact.evidenceIds)
            guard !evidenceIds.isEmpty,
                  evidenceIds.count == fact.evidenceIds.count else { return nil }
            materials = items.filter {
                evidenceIds.contains($0.evidenceId) && fact.matches($0)
            }
            guard materials.count == evidenceIds.count,
                  Set(materials.map(\.evidenceId)) == evidenceIds else { return nil }
        case "event":
            guard fact.evidenceIds.isEmpty,
                  let sourceId = fact.sourceId,
                  sourceId.hasPrefix("event:"),
                  researchDocumentIsPositiveIntegerString(String(sourceId.dropFirst(6))) else {
                return nil
            }
            let matchingEvents = events.filter { "event:\($0.id)" == sourceId }
            guard matchingEvents.count == 1,
                  matchingEvents[0].coverageScope == "research_stock",
                  ResearchEventCaptureDraft.supportedEventKinds.contains(matchingEvents[0].eventKind),
                  fact.claimType == matchingEvents[0].source.claimType,
                  fact.stance == matchingEvents[0].source.stance else { return nil }
            let event = matchingEvents[0]
            materials = items.filter { $0.matches(event.source) }
            guard materials.count == 1 else { return nil }
        default:
            return nil
        }
        let urls = materials.compactMap { $0.sourceUrl?.exactHTTPSURL }
        guard urls.count == materials.count, Set(urls).count == 1 else { return nil }
        return urls[0]
    }
}

private extension TwoLayerReportFact {
    func matches(_ material: ResearchMaterialData) -> Bool {
        (sourceId == nil || sourceId == "material:\(material.id)")
            && (claimType == nil || claimType == material.claimType)
            && (stance == nil || stance == material.stance)
    }
}

private extension ResearchMaterialData {
    func matches(_ source: ResearchAnnouncementEventSource) -> Bool {
        id == source.materialId
            && evidenceId == source.evidenceId
            && sourceType == source.sourceType
            && sourceUrl == source.sourceUrl
            && publishedAt == source.publishedAt
            && capturedAt == source.capturedAt
            && claimType == source.claimType
            && verificationStatus == source.verificationStatus
            && rightsStatus == source.rightsStatus
            && sourceVersion == source.sourceVersion
            && contentFingerprint == source.contentFingerprint
            && validUntil == source.validUntil
            && freshness == source.freshness
            && revision == source.revision
            && revisionState == source.revisionState
            && variableName == Optional(source.variableName)
            && stance == source.stance
            && reliability == source.reliability
            && materiality == source.materiality
    }
}

extension String {
    var exactHTTPSURL: URL? {
        guard utf16.count <= 2_000,
              let components = URLComponents(string: self),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil else { return nil }
        return components.url
    }
}
