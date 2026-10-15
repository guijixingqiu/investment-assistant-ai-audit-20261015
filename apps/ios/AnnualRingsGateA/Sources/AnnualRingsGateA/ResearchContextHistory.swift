import Foundation

public enum ResearchContextSection: String, CaseIterable, Codable, Equatable, Hashable, Sendable {
    case industry
    case selectedFacts = "selected_facts"
    case peerFacts = "peer_facts"
    case peers
    case operatingKpis = "operating_kpis"
    case macroDrivers = "macro_drivers"
    case industryDrivers = "industry_drivers"
    case unknowns
    case timeline
    case provenance
}

public struct ResearchContextItemCounts: Codable, Equatable, Sendable {
    public let selectedFacts: Int
    public let peerFacts: Int
    public let peers: Int
    public let operatingKpis: Int
    public let macroDrivers: Int
    public let industryDrivers: Int
    public let unknowns: Int

    var allNonNegative: Bool {
        [selectedFacts, peerFacts, peers, operatingKpis, macroDrivers, industryDrivers, unknowns].allSatisfy { $0 >= 0 }
    }
}

public struct ResearchContextHistoryEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let previousContextId: String?
    public let revision: Int
    public let industry: String
    public let cutoffAt: String
    public let validUntil: String
    public let createdAt: String
    public let itemCounts: ResearchContextItemCounts
}

public struct ResearchContextChangeSummary: Codable, Equatable, Sendable {
    public let previousContextId: String?
    public let currentContextId: String
    public let changedSections: [ResearchContextSection]
    public let unchangedSections: [ResearchContextSection]
}

func validateResearchContextHistory(
    _ history: [ResearchContextHistoryEntry],
    hasMore: Bool,
    changeSummary: ResearchContextChangeSummary?,
    current: ResearchContextData?,
    status: ResearchContextStatus,
    errors: inout [String]
) {
    guard status == .available else {
        if changeSummary != nil || (status == .notFound && (!history.isEmpty || hasMore)) {
            errors.append("non-available research context history is invalid")
        }
        validateResearchContextHistoryEntries(history, hasMore: hasMore, errors: &errors)
        return
    }
    guard let current, let summary = changeSummary, !history.isEmpty, history.count <= 20 else {
        errors.append("available research context requires bounded history and change summary")
        return
    }
    if history.first?.id != current.id || history.first?.matches(current) != true
        || summary.currentContextId != current.id
        || summary.previousContextId != history.dropFirst().first?.id {
        errors.append("research context history does not bind the current snapshot")
    }
    validateResearchContextHistoryEntries(history, hasMore: hasMore, errors: &errors)
    let changed = Set(summary.changedSections)
    let unchanged = Set(summary.unchangedSections)
    if changed.count != summary.changedSections.count
        || unchanged.count != summary.unchangedSections.count
        || !changed.isDisjoint(with: unchanged)
        || (summary.previousContextId == nil
            ? !changed.isEmpty || !unchanged.isEmpty
            : changed.union(unchanged) != Set(ResearchContextSection.allCases)) {
        errors.append("research context change summary is invalid")
    }
}

private extension ResearchContextHistoryEntry {
    func matches(_ context: ResearchContextData) -> Bool {
        industry == context.industry
            && cutoffAt == context.cutoffAt
            && validUntil == context.validUntil
            && createdAt == context.createdAt
            && itemCounts.selectedFacts == context.selectedFacts.count
            && itemCounts.peerFacts == context.peerFacts.count
            && itemCounts.peers == context.peers.count
            && itemCounts.operatingKpis == context.operatingKpis.count
            && itemCounts.macroDrivers == context.macroDrivers.count
            && itemCounts.industryDrivers == context.industryDrivers.count
            && itemCounts.unknowns == context.unknowns.count
    }
}

private func validateResearchContextHistoryEntries(
    _ history: [ResearchContextHistoryEntry],
    hasMore: Bool,
    errors: inout [String]
) {
    if history.count > 20 {
        errors.append("research context history is not bounded")
        return
    }
    var ids = Set<String>()
    var priorRevision = Int.max
    for (index, entry) in history.enumerated() {
        if !researchDocumentIsPositiveIntegerString(entry.id)
            || entry.previousContextId.map(researchDocumentIsPositiveIntegerString) == false
            || entry.revision <= 0 || entry.revision >= priorRevision
            || entry.industry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || entry.industry.count > 200
            || !isParseableDateTime(entry.cutoffAt)
            || !isParseableDateTime(entry.validUntil)
            || !isParseableDateTime(entry.createdAt)
            || !entry.itemCounts.allNonNegative
            || !ids.insert(entry.id).inserted {
            errors.append("research context history entry is invalid")
            break
        }
        let nextId = history.indices.contains(index + 1) ? history[index + 1].id : nil
        let lineageValid = nextId.map { entry.previousContextId == $0 }
            ?? (hasMore ? entry.previousContextId != nil : entry.previousContextId == nil)
        if !lineageValid {
            errors.append("research context history lineage is invalid")
            break
        }
        priorRevision = entry.revision
    }
}

func researchContextHistoryHasRequiredShape(_ root: [String: Any]) -> Bool {
    guard root["historyHasMore"] is Bool,
          let history = root["history"] as? [[String: Any]],
          history.count <= 20,
          history.allSatisfy({ entry in
              let keys = Set(entry.keys)
              guard Set([
                "id", "previousContextId", "revision", "industry", "cutoffAt",
                "validUntil", "createdAt", "itemCounts"
              ]).isSubset(of: keys),
              let counts = entry["itemCounts"] as? [String: Any] else { return false }
              return Set([
                "selectedFacts", "peerFacts", "macroDrivers", "industryDrivers", "unknowns"
              ]).isSubset(of: Set(counts.keys))
          }) else { return false }
    if root["changeSummary"] is NSNull { return true }
    guard let summary = root["changeSummary"] as? [String: Any] else { return false }
    return Set([
        "previousContextId", "currentContextId", "changedSections", "unchangedSections"
    ]).isSubset(of: Set(summary.keys))
}
