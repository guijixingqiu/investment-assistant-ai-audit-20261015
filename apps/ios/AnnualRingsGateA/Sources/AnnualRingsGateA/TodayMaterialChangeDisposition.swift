import Foundation

public struct TodayMaterialChangeDispositionRequest: Codable, Equatable, Sendable {
    public let itemId: String
    public let membershipVersion: Int
    public let sourceFingerprint: String
    public let state: TodayActionInboxItemState
    public let snoozedUntil: String?
    public let idempotencyKey: String

    public init(
        item: TodayActionInboxItem,
        state: TodayActionInboxItemState,
        snoozedUntil: Date? = nil,
        idempotencyKey: String,
        now: Date = Date()
    ) throws {
        guard [.new, .later, .resolved].contains(state),
              let fingerprint = item.source.sourceFingerprint else {
            throw TodayActionInboxValidationError.invalid(["Today disposition requires an exact action source and new/later/resolved state"])
        }
        if state == .later {
            guard let snoozedUntil,
                  snoozedUntil > now,
                  snoozedUntil <= now.addingTimeInterval(365 * 86_400) else {
                throw TodayActionInboxValidationError.invalid(["later disposition requires a return time within 365 days"])
            }
            self.snoozedUntil = ISO8601DateFormatter().string(from: snoozedUntil)
        } else {
            guard snoozedUntil == nil else {
                throw TodayActionInboxValidationError.invalid(["resolved disposition cannot carry a snooze time"])
            }
            self.snoozedUntil = nil
        }
        itemId = item.id
        membershipVersion = item.membership.version
        sourceFingerprint = fingerprint
        self.state = state
        self.idempotencyKey = idempotencyKey
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(itemId, forKey: .itemId)
        try container.encode(membershipVersion, forKey: .membershipVersion)
        try container.encode(sourceFingerprint, forKey: .sourceFingerprint)
        try container.encode(state, forKey: .state)
        if let snoozedUntil { try container.encode(snoozedUntil, forKey: .snoozedUntil) }
        else { try container.encodeNil(forKey: .snoozedUntil) }
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

public struct TodayMaterialChangeDispositionData: Codable, Equatable, Sendable {
    public let itemId: String
    public let membershipId: String
    public let membershipVersion: Int
    public let symbol: String
    public let sourceId: String
    public let sourceVersion: Int?
    public let sourceFingerprint: String
    public let state: TodayActionInboxItemState
    public let snoozedUntil: String?
    public let stateChangedAt: String
    public let stateReason: String
}

public extension ResearchWriteEnvelope where T == TodayMaterialChangeDispositionData {
    func validateForDisplay(item: TodayActionInboxItem, request: TodayMaterialChangeDispositionRequest) throws {
        var errors: [String] = []
        validateResearchWriteEnvelopeBase(self, label: "material disposition write", errors: &errors)
        if source.actorType != "user" || source.actorId?.isEmpty != false { errors.append("material disposition requires a user actor") }
        if data.itemId != request.itemId || data.itemId != item.id
            || data.membershipId != item.membership.id || data.membershipVersion != request.membershipVersion
            || data.symbol != item.symbol || data.sourceId != item.source.id
            || data.sourceVersion != item.source.version || data.sourceFingerprint != request.sourceFingerprint
            || data.state != request.state || data.snoozedUntil != request.snoozedUntil
            || ![.new, .later, .resolved].contains(data.state) {
            errors.append("material disposition write does not bind the requested Today item")
        }
        if parseInstant(data.stateChangedAt) == nil || data.stateReason.isEmpty {
            errors.append("material disposition state metadata is invalid")
        }
        if !errors.isEmpty { throw TodayActionInboxValidationError.invalid(errors) }
    }
}

enum TodayMaterialChangePresentation {
    static func nextFirst(_ items: [TodayActionInboxItem]) -> [TodayActionInboxItem] {
        items.sorted {
            let leftPriority = priorityRank($0.priority)
            let rightPriority = priorityRank($1.priority)
            if leftPriority != rightPriority { return leftPriority < rightPriority }
            let leftIsLater = $0.state == .later
            let rightIsLater = $1.state == .later
            return leftIsLater == rightIsLater ? $0.order < $1.order : !leftIsLater
        }
    }

    private static func priorityRank(_ value: String) -> Int {
        switch value {
        case "action": 0
        case "high": 1
        case "medium": 2
        default: 3
        }
    }

    static func sourceTypeLabel(_ value: String) -> String {
        switch value {
        case "candidate_memberships": "研究自选"
        case "research_profiles": "研究档案"
        case "deep_research_tasks": "深度研究任务"
        case "deep_research_reports": "研究报告"
        case "today_review_due_projection": "正式决定与复盘"
        case "today_research_projection": "研究进度"
        case "research_events": "研究事件"
        case "company_disclosure": "公司披露"
        default: "研究材料"
        }
    }

    static func freshnessLabel(_ value: String) -> String {
        switch value {
        case "fresh": "当前有效"
        case "missing": "来源待补"
        case "stale": "已过时"
        default: "暂不可用"
        }
    }

    static func openLabel(for item: TodayActionInboxItem) -> String {
        if item.kind == .marketAnomaly { return "查看异常轻调查" }
        if item.kind == .candidateFound { return "去建立研究档案" }
        if item.kind == .researchProfileReviewDue { return "去复核研究档案" }
        if item.kind == .research, item.title.contains("可能停滞") { return "去刷新研究任务" }
        if item.kind == .research, item.title.contains("综合完成") { return "去吸收研究结果" }
        if item.kind == .research, item.state == .later { return "查看进行中任务" }
        if item.kind == .materialChange {
            return item.researchTarget?.report == nil ? "核对这项变化" : "查看变化并修订报告"
        }
        if item.kind == .researchCompleted { return "去审阅研究结果" }
        if item.kind == .formalDecisionDue { return "去形成正式决定" }
        if item.kind == .reviewDue { return item.state == .resolved ? "查看已保存复盘" : "去完成正式复盘" }
        if item.kind == .dailyTracking { return item.state == .resolved ? "查看已保存复盘" : "去完成每日跟踪" }
        switch item.title {
        case "Add traceable research material": return "去导入原始材料"
        case "Freeze the current evidence version": return "去核对并冻结"
        case "Complete evidence-bound deep research": return "去生成研究报告"
        case "Confirm or reject the deep-research version": return "去审阅研究报告"
        default: return "进入研究并重新读取"
        }
    }

    static func localizedResearchTitle(_ value: String) -> String {
        switch value {
        case "Add traceable research material": "补充可追溯的研究材料"
        case "Freeze the current evidence version": "冻结更新后的证据版本"
        case "Complete evidence-bound deep research": "生成证据绑定的研究报告"
        case "Confirm or reject the deep-research version": "确认或驳回最新研究报告"
        default: value
        }
    }

    static func localizedMaterialChangeTitle(_ value: String) -> String {
        if value == "Geely–Ford Spain manufacturing joint venture announcement" {
            return "吉利与福特在西班牙成立制造合资公司"
        }
        return localizedResearchTitle(value)
    }

    static func localizedResearchSummary(title: String, fallback: String) -> String {
        switch title {
        case "Add traceable research material": "先保存公司披露或可信媒体的摘要与原文链接，再用已有资料开始研究；未核实内容会明确标记。"
        case "Freeze the current evidence version": "真实日线或材料已经更新，旧证据包已转为历史；请核对后明确冻结当前版本。"
        case "Complete evidence-bound deep research": "当前证据已冻结；请明确发起综合，并在结果返回后审阅。"
        case "Confirm or reject the deep-research version": "报告已经生成，需要你明确确认或驳回。"
        default: fallback == "UNKNOWN" ? "打开后重新读取最新研究事实。" : fallback
        }
    }

    static func stageLabel(for item: TodayActionInboxItem) -> String {
        return switch item.kind {
        case .candidateFound: "候选"
        case .researchProfileReviewDue: "研究维护"
        case .research:
            item.title == "Confirm or reject the deep-research version" ? "报告" : "研究"
        case .researchCompleted: "报告"
        case .materialChange: item.researchTarget?.report == nil ? "研究" : "报告"
        case .marketAnomaly: "市场异常"
        case .formalDecisionDue: "决定"
        case .reviewDue, .dailyTracking: "跟踪复盘"
        case .sourceFailure: "来源恢复"
        }
    }

    static func stateLabel(for item: TodayActionInboxItem) -> String {
        switch item.state {
        case .new: "待你处理"
        case .later: item.kind == .research ? "处理中" : "稍后处理"
        case .resolved: "已完成"
        case .expired: "已过期"
        case .blocked: "来源受阻"
        }
    }

    static func userSummary(for item: TodayActionInboxItem) -> String {
        switch item.kind {
        case .candidateFound:
            "候选已经加入跟踪；进入研究后会重新读取当前材料、证据和来源状态。"
        case .researchProfileReviewDue:
            item.summary
        case .research:
            localizedResearchSummary(title: item.title, fallback: item.summary)
        case .researchCompleted:
            item.state == .resolved
                ? "研究报告已经由你处理；后续以正式决定或复盘待办为准。"
                : researchCompletedSummary(item.versionChange ?? item.summary)
        case .materialChange:
            summary(item.summary)
        case .marketAnomaly:
            item.summary
        case .formalDecisionDue:
            "报告已经由你确认；仍需明确采用报告并提交人工决定。"
        case .reviewDue:
            item.state == .resolved ? "与正式决定绑定的复盘已经保存。" : "正式决定已经记录，等待你保存本次复盘。"
        case .dailyTracking:
            item.state == .resolved
                ? "本次每日跟踪已经复盘。"
                : formalDecisionTrackingSummary(event: item.reviewEvent)
                    ?? "根据当前报告和正式决定完成下一验证与复盘。"
        case .sourceFailure:
            "研究或复盘来源暂不可用；重新读取成功前不会展示旧事实或部分事实。"
        }
    }

    static func completionHint(for item: TodayActionInboxItem) -> String {
        if item.state == .resolved { return "此项已按最新事实完成。" }
        if item.state == .expired { return "该版本已经过期，请以当前待办为准。" }
        return switch item.kind {
        case .candidateFound: "建立研究档案并产生研究事项后，这条候选提醒会自动更新。"
        case .researchProfileReviewDue: "更新研究档案的下次复核日后，这条提醒会按最新日期自动更新。"
        case .research:
            item.title == "Add traceable research material"
                ? "成功导入并核对一条公司官方材料，且来源可以重新打开后，这条缺口会自动更新。"
                : item.summary.contains("超过任务租约")
                ? "刷新同一任务；若仍停滞，由你明确取消并重新准备，系统不会重复发起。"
                : item.summary.contains("已绑定当前冻结证据")
                ? "明确吸收综合结果并生成报告修订后，这条行动会自动更新。"
                : item.state == .later
                ? "稍后刷新同一任务，读取最新状态；不会重复发起。"
                : "完成打开后的明确研究动作，今日页会按最新事实重建下一步。"
        case .researchCompleted: "吸收研究结果并确认或驳回报告后自动更新。"
        case .materialChange: "可标记稍后或已处理；研究事实变化时会按新版本重建。"
        case .marketAnomaly: "查看自动轻调查；是否需要 AI 深入调查由你决定。价格本身不改变正式研究。"
        case .formalDecisionDue: "采用已确认报告并提交人工决定后自动关闭。"
        case .reviewDue: "保存与该正式决定绑定的复盘后自动更新。"
        case .dailyTracking: "提交本次跟踪复盘后自动更新；论点失效时会生成重新审视行动。"
        case .sourceFailure: "来源恢复并重新读取成功后自动消失。"
        }
    }

    static func summary(_ value: String) -> String {
        for suffix in [" Hypothesis impact: supports.", " Hypothesis impact: weakens.", " Hypothesis impact: unknown."] where value.hasSuffix(suffix) {
            let summary = String(value.dropLast(suffix.count))
            if summary.hasPrefix("The issuer says Geely will hold 34% of the Valencia target") {
                return "吉利公告称将持有西班牙 Valencia 目标公司 34% 权益，并与福特成立乘用车合同制造合资公司。这支持继续核验海外制造能力假设，最终投资影响仍需由你判断。"
            }
            return summary
        }
        return value
    }

    static func researchCompletedSummary(_ value: String) -> String {
        let change = summary(value).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !change.isEmpty, change.uppercased() != "UNKNOWN" else {
            return "研究结果已返回；报告没有提供可比较的版本变化。先核对当前判断，系统不会自动采用。"
        }
        return "研究结果已返回：\(change)。先核对它是否改变当前判断，系统不会自动采用。"
    }

    static func impactLabel(_ value: String) -> String {
        switch value {
        case "supports": "支持原论点"
        case "weakens": "削弱原论点"
        default: "尚不能判断"
        }
    }

    static func sourceLabel(_ value: String) -> String {
        switch value {
        case "issuer_disclosure": "公司公告"
        case "exchange_filing": "交易所披露"
        case "news": "新闻资料"
        default: value
        }
    }

    static func reviewDueStatusText(_ envelope: TodayReviewDueEnvelope) -> String {
        switch envelope.status {
        case .available:
            if envelope.event?.type == "FORMAL_DECISION_DUE" { return "确认报告待正式决定" }
            if envelope.event?.type == "DAILY_TRACKING" { return envelope.event?.state == .new ? "每日跟踪 · 下一验证" : "每日跟踪已复盘" }
            return envelope.event?.state == .new ? "待复盘" : "复盘已完成"
        case .empty: return "暂无正式决定记录"
        case .unavailable: return "正式事件暂不可用"
        }
    }

    static func reviewDueEventLabel(_ event: TodayReviewDueEvent) -> String {
        if event.type == "FORMAL_DECISION_DUE" { return "下一步：形成正式决定" }
        if event.dailyTrackingReconsiderationOutcome != nil { return "下一步：重新审视正式决定" }
        if event.type == "DAILY_TRACKING" { return event.state == .new ? "下一步：完成每日跟踪" : "每日跟踪已完成" }
        return event.state == .new ? "下一步：完成复盘" : "复盘已完成"
    }

    static func formalDecisionTrackingSummary(event: TodayReviewDueEvent?) -> String? {
        guard let humanDecision = event?.humanDecision else { return nil }
        return formalDecisionTrackingSummary(
            actionIntent: humanDecision.actionIntent,
            state: humanDecision.formalDecision
        )
    }

    static func formalDecisionTrackingSummary(
        actionIntent: String,
        state: FormalDecisionState?
    ) -> String? {
        guard state?.availability == "preserved", let owner = state?.ownerDecision else { return nil }
        let ownerDirection = DecisionActionIntent(rawValue: actionIntent)?.label ?? actionIntent
        let systemDirection = state?.systemRecommendation.flatMap {
            DecisionActionIntent(rawValue: $0.direction)?.label
        } ?? "UNKNOWN"
        var lines = [
            "Owner 决定：\(ownerDirection) · 系统方向：\(systemDirection)",
            "理由：\(owner.reason)",
            "期限：\(owner.horizon) · 复核：\(owner.reviewOn)",
            "价格条件：\(owner.priceConditions)",
            "研究仓位：\(owner.positionRange)",
            "主要风险：\(owner.mainRisks)",
            "失效条件：\(owner.invalidationConditions)"
        ]
        if let divergence = owner.divergenceReason { lines.append("与系统不同：\(divergence)") }
        if state?.personalRiskAssessment?.requiresOverride == true,
           let overrideReason = owner.personalRisk?.overrideReason {
            lines.append("个人风险覆盖：\(overrideReason)")
        }
        return lines.joined(separator: "\n")
    }
}

extension TodayResearchStatus {
    var userLabel: String {
        switch self {
        case .available: "已更新"
        case .stale: "需要刷新"
        case .conflict: "数据冲突"
        case .notFound: "尚无记录"
        case .unauthorized: "未授权"
        case .malformed: "数据格式异常"
        case .unavailable: "暂不可用"
        }
    }
}

extension TodayResearchTrackingState {
    var userLabel: String {
        switch self {
        case .needsMaterial: "待补材料"
        case .needsEvidencePack: "待冻结证据"
        case .needsResearch: "待生成报告"
        case .awaitingUserConfirmation: "待你确认"
        case .needsReview: "待复核"
        case .confirmed: "已确认"
        case .rejected: "已驳回"
        }
    }
}
