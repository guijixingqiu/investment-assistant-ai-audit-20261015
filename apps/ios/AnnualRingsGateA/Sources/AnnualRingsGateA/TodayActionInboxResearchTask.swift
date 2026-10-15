import Foundation

public struct TodayActionInboxResearchTask: Codable, Equatable, Hashable, Sendable {
    public let id: String
    public let requestFingerprint: String
    public let evidencePackId: String
    public let evidencePackFingerprint: String
    public let completedAt: String?

    func validate(
        report: TodayActionInboxResearchTarget.Report?,
        now: Date,
        errors: inout [String]
    ) {
        if id.isEmpty
            || requestFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || report.map({ evidencePackId != $0.evidencePackId }) == true
            || evidencePackFingerprint.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) == nil
            || completedAt.map({ parseInstant($0).map({ $0 > now }) != false }) == true {
            errors.append("completed research task binding is invalid")
        }
    }
}
