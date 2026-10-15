import Foundation

public struct FrozenResearchSourceGap: Codable, Equatable, Sendable {
    public let status: String
    public let value: String
    public let eventId: String?
    public let eventVersion: Int?
    public let eventFingerprint: String?
    public let materialId: String?
    public let evidenceId: String?
    public let keyVariable: String?
    public let hypothesisImpact: String?

    var isValid: Bool {
        if status == "source_missing" {
            return value == "UNKNOWN"
                && eventId == nil && eventVersion == nil && eventFingerprint == nil
                && materialId == nil && evidenceId == nil && keyVariable == nil
                && hypothesisImpact == nil
        }
        return status == "bound"
            && value == "EVENT"
            && eventId.map(researchDocumentIsPositiveIntegerString) == true
            && (eventVersion ?? 0) > 0
            && eventFingerprint?.isFrozenSHA256 == true
            && materialId.map(researchDocumentIsPositiveIntegerString) == true
            && evidenceId.map(researchDocumentIsPositiveIntegerString) == true
            && !(keyVariable ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && hypothesisImpact.map { ["supports", "weakens", "unknown"].contains($0) } == true
    }
}

public struct FrozenResearchSourceGaps: Codable, Equatable, Sendable {
    public let macro: FrozenResearchSourceGap
    public let industry: FrozenResearchSourceGap
    public let event: FrozenResearchSourceGap
    public let risk: FrozenResearchSourceGap
    public let counterevidence: FrozenResearchSourceGap

    var allMissing: Bool {
        [macro, industry, event, risk, counterevidence].allSatisfy {
            $0.status == "source_missing" && $0.value == "UNKNOWN"
        }
    }

    var isValid: Bool {
        macro.isValid && industry.isValid && event.isValid && risk.isValid && counterevidence.isValid
            && macro.status == "source_missing"
            && industry.status == "source_missing"
            && risk.status == "source_missing"
            && counterevidence.status == "source_missing"
    }
}
