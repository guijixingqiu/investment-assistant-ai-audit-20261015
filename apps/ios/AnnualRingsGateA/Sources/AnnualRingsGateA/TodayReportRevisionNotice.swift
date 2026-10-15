import Foundation

/// A session-local bridge between Today/global assistant and the exact Research report.
/// It is deliberately not a server event and never represents a decision.
public enum TodayReportRevisionSource: Equatable, Hashable, Sendable {
    case dailyReview(String)
    case reportCard(String)

    public var label: String {
        switch self {
        case .dailyReview(let id): return "每日跟踪复盘 #\(id)"
        case .reportCard(let id): return "当前报告卡 #\(id)"
        }
    }

    public var reviewId: String? {
        if case .dailyReview(let id) = self { return id }
        return nil
    }
}

public struct TodayReportRevisionSourceReservation: Equatable, Sendable {
    public let source: TodayReportRevisionSource
    public let token: UUID

    public init(source: TodayReportRevisionSource, token: UUID = UUID()) {
        self.source = source
        self.token = token
    }
}

/// A session-local reservation for the first report save reached from a fresh
/// Today `needs_research` action. It binds the save completion to the exact
/// action, membership, source identity, frozen pack, and authorization that
/// produced the navigation target.
public struct TodayResearchReportSaveReservation: Equatable, Sendable {
    public let token: UUID
    public let itemId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let actorId: String
    public let sourceLane: String
    public let sourceId: String
    public let sourceVersion: Int?
    public let sourceType: String
    public let sourceFingerprint: String?
    public let evidencePackId: String
    public let evidencePackVersion: Int
    public let evidencePackFingerprint: String
    public let authorizationRevision: UUID

    public init(
        itemId: String,
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        actorId: String,
        sourceLane: String,
        sourceId: String,
        sourceVersion: Int?,
        sourceType: String,
        sourceFingerprint: String?,
        evidencePackId: String,
        evidencePackVersion: Int,
        evidencePackFingerprint: String,
        authorizationRevision: UUID,
        token: UUID = UUID()
    ) {
        self.token = token
        self.itemId = itemId
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.actorId = actorId
        self.sourceLane = sourceLane
        self.sourceId = sourceId
        self.sourceVersion = sourceVersion
        self.sourceType = sourceType
        self.sourceFingerprint = sourceFingerprint
        self.evidencePackId = evidencePackId
        self.evidencePackVersion = evidencePackVersion
        self.evidencePackFingerprint = evidencePackFingerprint
        self.authorizationRevision = authorizationRevision
    }
}

public struct TodayReportRevisionNotice: Equatable, Hashable, Identifiable, Sendable {
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let reportId: String
    public let reportVersion: Int
    public let reportFingerprint: String
    public let evidencePackId: String
    public let source: TodayReportRevisionSource
    public let nextValidationQuestion: String
    public let savedAt: String
    public let assistantHandoff: ResearchAssistantHandoff?

    public var id: String {
        "\(membershipId)|\(membershipVersion)|\(symbol)|\(reportId)|\(reportVersion)|\(reportFingerprint)|\(String(describing: assistantHandoff))"
    }

    public var sourceLabel: String { source.label }
    public var sourceReviewId: String? { source.reviewId }

    public init(
        membershipId: String,
        membershipVersion: Int,
        symbol: String,
        reportId: String,
        reportVersion: Int,
        reportFingerprint: String,
        evidencePackId: String,
        source: TodayReportRevisionSource,
        nextValidationQuestion: String,
        savedAt: String,
        assistantHandoff: ResearchAssistantHandoff? = nil
    ) {
        self.membershipId = membershipId
        self.membershipVersion = membershipVersion
        self.symbol = symbol
        self.reportId = reportId
        self.reportVersion = reportVersion
        self.reportFingerprint = reportFingerprint
        self.evidencePackId = evidencePackId
        self.source = source
        self.nextValidationQuestion = nextValidationQuestion
        self.savedAt = savedAt
        self.assistantHandoff = assistantHandoff
    }
}
