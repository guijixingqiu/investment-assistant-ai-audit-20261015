import Foundation

public struct ResearchEventHoldingBinding: Codable, Equatable, Sendable {
    public let accountScopeId: String
    public let snapshotId: String
    public let sourceBatchId: String
    public let sourceAsOf: String
    public let positionSourceRowId: String

    var isExactCurrentHoldingIdentity: Bool {
        !accountScopeId.isEmpty
            && !snapshotId.isEmpty
            && !sourceBatchId.isEmpty
            && isParseableDateTime(sourceAsOf)
            && positionSourceRowId.hasPrefix("broker_import_batches:\(sourceBatchId)/")
    }
}

public struct ResearchEventCaptureDraft: Equatable, Sendable {
    public static let holdingLogicSourceType = "owner_verified_holding_logic"
    public static let exchangeAnnouncementLeadSourceType = "exchange_announcement_lead"
    public static let supportedEventKinds = [
        "announcement", "financial_report", "corporate_action", "major_news", "news"
    ]
    public var title = ""
    public var summary = ""
    public var sourceURL = ""
    public var publishedAt = Date()
    public var validUntil = Calendar.current.date(byAdding: .day, value: 90, to: Date()) ?? Date()
    public var eventKind = "announcement"
    public var coverageScope = "research_stock"
    public var variableName = ""
    public var stance = "neutral"
    public var reliability = 3
    public var materiality = 3
    public var ownerVerified = false
    public var monitorRuleBinding: ResearchMonitorRule?
    public var replacementMaterial: ResearchMaterialData?
    public var replacementSourceVersion = ""
    public init() {}

    public mutating func prepareForVerification(
        _ handoff: NoticeLeadResearchHandoff,
        variableName: String,
        now: Date = Date()
    ) -> Bool {
        guard let publishedAt = parseInstant(handoff.item.publishedAt), publishedAt <= now else { return false }
        self = ResearchEventCaptureDraft()
        title = handoff.item.title
        sourceURL = handoff.item.url
        eventKind = Self.suggestedEventKind(for: handoff.item)
        self.publishedAt = publishedAt
        self.variableName = variableName
        return true
    }

    public mutating func prepareForVerification(
        _ item: OfficialAnnouncementDiscoveryItem,
        variableName: String,
        now: Date = Date()
    ) -> Bool {
        guard let publishedAt = parseInstant("\(item.publishedDate)T00:00:00+08:00"),
              publishedAt <= now else { return false }
        self = ResearchEventCaptureDraft()
        title = item.title
        sourceURL = item.documentUrl
        eventKind = Self.suggestedEventKind(for: item)
        self.publishedAt = publishedAt
        self.variableName = variableName
        return true
    }

    public mutating func prepareForVerification(
        _ material: ResearchMaterialData,
        variableName: String,
        now: Date = Date()
    ) -> Bool {
        guard material.sourceType == Self.exchangeAnnouncementLeadSourceType,
              material.revisionState == "current",
              let sourceURL = material.sourceUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              !sourceURL.isEmpty,
              let url = URL(string: sourceURL),
              url.scheme == "https",
              url.host != nil,
              let publishedAt = material.publishedAt.flatMap(parseInstant),
              publishedAt <= now else { return false }
        self = ResearchEventCaptureDraft()
        title = material.title
        self.sourceURL = sourceURL
        self.publishedAt = publishedAt
        self.variableName = variableName
        return true
    }

    public func materialRequest(
        membership: CandidateMembershipData,
        allowedVariables: [String],
        idempotencyKey: String,
        now: Date = Date()
    ) -> CreateResearchMaterialRequest? {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceURL = sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let variableName = variableName.trimmingCharacters(in: .whitespacesAndNewlines)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let holdingLogic = coverageScope == "current_holding"
        let sourceType = replacementMaterial?.sourceType
            ?? (holdingLogic ? Self.holdingLogicSourceType
                : Self.sourceType(forEventKind: eventKind) ?? "")
        let sourceVersion = replacementMaterial == nil
            ? "owner-verified:\(formatter.string(from: publishedAt))"
            : replacementSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ownerVerified,
              membership.state == .tracked,
              (1...500).contains(title.count),
              (1...4_000).contains(summary.count),
              sourceURL.count <= 2_000,
              (1...200).contains(sourceVersion.count),
              let url = URL(string: sourceURL),
              url.scheme == "https",
              url.host != nil,
              allowedVariables.contains(variableName),
              Self.supportedEventKinds.contains(eventKind),
              !sourceType.isEmpty,
              ["research_stock", "current_holding"].contains(coverageScope),
              ["support", "refute", "neutral"].contains(stance),
              (1...5).contains(reliability),
              (1...5).contains(materiality),
              publishedAt <= now,
              validUntil > publishedAt,
              replacementMaterial.map({ material in
                  material.validates(expected: membership)
                      && (!holdingLogic || material.sourceType == Self.holdingLogicSourceType)
                      && material.revisionState == "current"
                      && ["conflict", "rejected"].contains(material.verificationStatus)
                      && ["user_provided", "authorized_public"].contains(material.rightsStatus)
                      && material.sourceUrl == sourceURL
                      && sourceVersion != material.sourceVersion
              }) != false else { return nil }
        return CreateResearchMaterialRequest(
            membershipId: membership.id,
            membershipVersion: membership.version,
            title: title,
            contentText: summary,
            sourceType: sourceType,
            sourceUrl: sourceURL,
            publishedAt: formatter.string(from: publishedAt),
            claimType: "verified_fact",
            verificationStatus: "verified",
            rightsStatus: replacementMaterial?.rightsStatus ?? "user_provided",
            sourceVersion: sourceVersion,
            replacesMaterialId: replacementMaterial?.id,
            validUntil: formatter.string(from: validUntil),
            summary: summary,
            variableName: variableName,
            stance: stance,
            reliability: reliability,
            materiality: materiality,
            isRead: true,
            ownerCorrectionBinding: nil,
            assistantCorrectionBinding: nil,
            idempotencyKey: idempotencyKey
        )
    }

    public var fingerprint: String {
        [title, summary, sourceURL,
         String(publishedAt.timeIntervalSince1970), String(validUntil.timeIntervalSince1970),
         eventKind, coverageScope, variableName, stance,
         String(reliability), String(materiality), String(ownerVerified),
         monitorRuleBinding.map { "\($0.variableName)|\($0.category)|\($0.source)|\($0.cadence)|\($0.threshold)|\($0.reason)|\($0.version ?? 0)|\($0.confirmedAt ?? "")" } ?? "",
         replacementMaterial?.id ?? "", replacementMaterial?.contentFingerprint ?? "",
         replacementMaterial?.sourceVersion ?? "", replacementSourceVersion].joined(separator: "|")
    }

    public func sourceMaterialRequest(
        membership: CandidateMembershipData,
        claimType: String,
        idempotencyKey: String,
        now: Date = Date()
    ) -> CreateResearchMaterialRequest? {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceURL = sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard membership.state != .archived, (1...500).contains(title.count),
              (1...4_000).contains(summary.count), sourceURL.count <= 2_000,
              let url = URL(string: sourceURL), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, publishedAt <= now, validUntil > now,
              ["issuer_statement", "third_party_statement"].contains(claimType) else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return CreateResearchMaterialRequest(
            membershipId: membership.id, membershipVersion: membership.version,
            title: title, contentText: summary, sourceType: "owner_provided_source_excerpt",
            sourceUrl: sourceURL, publishedAt: formatter.string(from: publishedAt),
            claimType: claimType, verificationStatus: "unverified", rightsStatus: "user_provided",
            sourceVersion: "source-excerpt:\(formatter.string(from: publishedAt))", replacesMaterialId: nil,
            validUntil: formatter.string(from: validUntil), summary: summary, variableName: nil,
            stance: "neutral", reliability: nil, materiality: nil, isRead: true,
            ownerCorrectionBinding: nil, assistantCorrectionBinding: nil, idempotencyKey: idempotencyKey
        )
    }

    public mutating func reset(preserving variableName: String, coverageScope: String = "research_stock") {
        self = ResearchEventCaptureDraft()
        self.variableName = variableName
        self.coverageScope = coverageScope
    }

    public mutating func bindMonitorRule(_ rule: ResearchMonitorRule) {
        monitorRuleBinding = rule
        variableName = rule.variableName
        eventKind = ResearchMonitorRule.eventKind(forMonitorCategory: rule.category)
        coverageScope = "research_stock"
    }

    public static func sourceType(forEventKind value: String) -> String? {
        switch value {
        case "announcement": "owner_verified_announcement"
        case "financial_report": "owner_verified_financial_report"
        case "corporate_action": "owner_verified_corporate_action"
        case "major_news": "owner_verified_major_news"
        case "news": "owner_verified_news"
        default: nil
        }
    }

    public static func eventKind(forSourceType value: String) -> String? {
        supportedEventKinds.first { sourceType(forEventKind: $0) == value }
    }

    public static func suggestedEventKind(for item: NoticeLeadDiscoveryItem) -> String {
        guard item.kind != "major_news" else { return "major_news" }
        let title = item.title.lowercased()
        if ["annual results", "interim results", "quarterly results", "annual report",
            "年度业绩", "中期业绩", "季度业绩", "年报", "中报"]
            .contains(where: title.contains) {
            return "financial_report"
        }
        if ["dividend", "share repurchase", "buy-back", "rights issue", "placing",
            "派息", "股息", "回购", "供股", "配股", "股份拆细", "股份合并"]
            .contains(where: title.contains) {
            return "corporate_action"
        }
        return "announcement"
    }

    public static func suggestedEventKind(for item: OfficialAnnouncementDiscoveryItem) -> String {
        switch item.category {
        case .financialReport: "financial_report"
        case .corporateAction: "corporate_action"
        case .businessChange, .administrative, .other: "announcement"
        }
    }
}
