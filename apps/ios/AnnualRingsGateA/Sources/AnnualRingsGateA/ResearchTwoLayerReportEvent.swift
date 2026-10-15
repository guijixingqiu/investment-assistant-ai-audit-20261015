import Foundation

extension FrozenResearchEvidencePack {
    var deterministicEventFact: TwoLayerReportFact? {
        let gap = frozenResearchContext?.unboundSources.event
        guard gap?.status == "bound",
              let material = items.first(where: { $0.id == gap?.materialId && $0.evidenceId == gap?.evidenceId }) else {
            return nil
        }
        return TwoLayerReportFact(
            statement: "\(material.title): \(material.summary.isEmpty ? String(material.contentText.prefix(400)) : material.summary)",
            evidenceIds: [material.evidenceId],
            sourceKind: "material",
            claimType: material.claimType,
            stance: material.stance
        )
    }

    var deterministicUnknownKeys: [String] {
        let eventIsMissing = frozenResearchContext?.unboundSources.event.status == "source_missing"
        return ["macro", "industry", "event", "risk", "counterevidence"].filter { $0 != "event" || eventIsMissing }
    }
}
