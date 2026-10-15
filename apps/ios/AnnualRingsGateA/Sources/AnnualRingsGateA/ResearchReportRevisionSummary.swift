import Foundation

public enum ResearchReportLifecycleState: String, Equatable, Sendable {
    case evidenceInsufficient
    case completePendingConfirmation
    case confirmed
    case rejected
    case historical

    public var label: String {
        switch self {
        case .evidenceInsufficient: "证据不足"
        case .completePendingConfirmation: "完整待确认"
        case .confirmed: "已确认"
        case .rejected: "已驳回"
        case .historical: "历史版本"
        }
    }
}

/// A deterministic, read-only comparison between two fresh report versions.
/// It never infers a new thesis or treats a historical report as current.
public struct ResearchReportRevisionSummary: Equatable, Sendable {
    public let currentVersion: Int
    public let previousVersion: Int?
    public let declaredChange: String
    public let changedSections: [String]
    public let unchangedSections: [String]
    public let bindingChanged: Bool?
    public let comparisonUnavailableReason: String?

    public var hasPreviousVersion: Bool { previousVersion != nil }
    public var hasStructuralChange: Bool { !changedSections.isEmpty }

    public func ownerBriefChange(nextObservation: String?) -> String? {
        if let comparisonUnavailableReason { return comparisonUnavailableReason }
        guard hasPreviousVersion else { return nil }
        let judgmentSections = [
            "结论", "置信度", "适用期限", "时间视角", "长期观点与条件",
            "中短期观点与条件", "长短期冲突", "估值与技术事实", "风险", "反证",
            "判断方向", "价格条件", "价格区间", "研究仓位假设", "假设与情景"
        ]
        let judgmentChanges = changedSections.filter(judgmentSections.contains)
        let factChanges = changedSections.filter {
            !judgmentSections.contains($0)
                && $0 != "下一验证问题"
                && $0 != "下一问题"
        }.map { $0 == "证据绑定" ? "研究依据" : $0 }
        if judgmentChanges.isEmpty {
            let next = nextObservation?.trimmingCharacters(in: .whitespacesAndNewlines)
            let factChange = factChanges.isEmpty
                ? ""
                : "；最近事实或依据变化：\(factChanges.joined(separator: "、"))"
            return "判断未变：结论、估值条件、风险和反证未变\(factChange)。下一观察条件：\(next.flatMap { $0.isEmpty ? nil : $0 } ?? "目前未设定，请先核对最新来源")"
        }
        let factChange = factChanges.isEmpty
            ? ""
            : "；最近事实或依据变化：\(factChanges.joined(separator: "、"))"
        return "研究内容已更新：\(judgmentChanges.joined(separator: "、"))\(factChange)。文字变化不等于判断方向改变，请核对本次新增证据。"
    }

    public init(
        currentVersion: Int,
        previousVersion: Int?,
        declaredChange: String,
        changedSections: [String],
        unchangedSections: [String],
        bindingChanged: Bool?,
        comparisonUnavailableReason: String? = nil
    ) {
        self.currentVersion = currentVersion
        self.previousVersion = previousVersion
        self.declaredChange = declaredChange
        self.changedSections = changedSections
        self.unchangedSections = unchangedSections
        self.bindingChanged = bindingChanged
        self.comparisonUnavailableReason = comparisonUnavailableReason
    }
}

public extension TwoLayerReportData {
    func lifecycleState(decision: TwoLayerReportDecision?) -> ResearchReportLifecycleState {
        guard currentness.status == "current",
              currentness.invalidatedBy.isEmpty,
              currentness.evidencePackInvalidatedBy.isEmpty else { return .historical }
        if decision?.decision == "confirmed" { return .confirmed }
        if decision?.decision == "rejected" { return .rejected }
        return status == "evidence_insufficient"
            ? .evidenceInsufficient
            : .completePendingConfirmation
    }

    /// Compares only data present in the two fresh GET report payloads.
    /// Missing previous history produces an explicit first-version summary.
    func revisionSummary(previous: TwoLayerReportData?) -> ResearchReportRevisionSummary {
        let declaredChange = payload.changeFromPrevious
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let declared = declaredChange.isEmpty ? "未填写版本变化说明" : declaredChange
        guard let previous, previous.id != id else {
            return ResearchReportRevisionSummary(
                currentVersion: version,
                previousVersion: nil,
                declaredChange: declared,
                changedSections: [],
                unchangedSections: [],
                bindingChanged: nil
            )
        }

        guard contractVersion == previous.contractVersion,
              payload.adviceLayer != nil, payload.researchLayer != nil,
              previous.payload.adviceLayer != nil, previous.payload.researchLayer != nil else {
            return ResearchReportRevisionSummary(
                currentVersion: version, previousVersion: previous.version,
                declaredChange: declared, changedSections: [], unchangedSections: [],
                bindingChanged: nil,
                comparisonUnavailableReason: "暂不可比较：前后报告格式或判断字段不同；保留历史原文，不能据此认定判断未变。"
            )
        }

        let comparison = researchSectionComparison(current: self, previous: previous)
        var changed = comparison.changed
        var unchanged = comparison.unchanged

        let bindingChanged: Bool?
        if let currentBinding = payload.evidencePackBinding,
           let previousBinding = previous.payload.evidencePackBinding {
            bindingChanged = currentBinding != previousBinding
            if bindingChanged == true {
                changed.append("证据绑定")
            } else {
                unchanged.append("证据绑定")
            }
        } else {
            bindingChanged = nil
        }

        return ResearchReportRevisionSummary(
            currentVersion: version,
            previousVersion: previous.version,
            declaredChange: declared,
            changedSections: changed,
            unchangedSections: unchanged,
            bindingChanged: bindingChanged
        )
    }
}

public extension Array where Element == TwoLayerReportData {
    func previousReport(before report: TwoLayerReportData) -> TwoLayerReportData? {
        filter { $0.version < report.version }.max { $0.version < $1.version }
    }

    func revisionSummary(between firstId: String?, and secondId: String?) -> ResearchReportRevisionSummary? {
        guard let firstId, let secondId, firstId != secondId,
              let left = first(where: { $0.id == firstId }),
              let right = first(where: { $0.id == secondId }) else { return nil }
        let older = left.version < right.version ? left : right
        let newer = left.version < right.version ? right : left
        return newer.revisionSummary(previous: older)
    }
}

/// Ordered section-by-section comparison of two stored report payloads.
private struct ResearchSectionComparison {
    private(set) var changed: [String] = []
    /// Sections both versions read the same. A section neither version records
    /// stays listed here, because version history reads an unrecorded field as
    /// unchanged, and is repeated in `unrecorded` so cross-stock reading can
    /// tell "both blank" apart from "both recorded the same".
    private(set) var unchanged: [String] = []
    private(set) var unrecorded: [String] = []

    /// `isEmpty` decides whether a present value records nothing, for example
    /// blank text, an empty list, or a list whose sub-values are all missing.
    /// Values without a natural emptiness notion count as recorded.
    mutating func append<Value: Equatable>(
        _ label: String,
        _ current: Value?,
        _ previous: Value?,
        isEmpty: (Value) -> Bool = { _ in false }
    ) {
        guard current == previous else {
            changed.append(label)
            return
        }
        unchanged.append(label)
        if current.map(isEmpty) ?? true {
            unrecorded.append(label)
        }
    }
}

/// Compares every stored section except the evidence-pack binding, which the
/// caller reads separately.
private func researchSectionComparison(
    current: TwoLayerReportData,
    previous: TwoLayerReportData
) -> ResearchSectionComparison {
    var comparison = ResearchSectionComparison()
    comparison.append(
        "结论",
        current.payload.adviceLayer?.conclusion,
        previous.payload.adviceLayer?.conclusion,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "置信度",
        current.payload.adviceLayer?.confidence,
        previous.payload.adviceLayer?.confidence,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "适用期限",
        current.payload.adviceLayer?.applicableUntil,
        previous.payload.adviceLayer?.applicableUntil,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "时间视角",
        current.payload.adviceLayer?.horizonStatement,
        previous.payload.adviceLayer?.horizonStatement,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "长期观点与条件",
        current.payload.adviceLayer?.longTerm,
        previous.payload.adviceLayer?.longTerm
    )
    comparison.append(
        "中短期观点与条件",
        current.payload.adviceLayer?.mediumShortTerm,
        previous.payload.adviceLayer?.mediumShortTerm
    )
    comparison.append(
        "长短期冲突",
        current.payload.adviceLayer?.conflict,
        previous.payload.adviceLayer?.conflict
    )
    comparison.append(
        "判断方向",
        current.payload.adviceLayer?.direction,
        previous.payload.adviceLayer?.direction,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "价格条件",
        current.payload.adviceLayer?.priceConditions,
        previous.payload.adviceLayer?.priceConditions,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "价格区间",
        current.payload.adviceLayer?.priceRange,
        previous.payload.adviceLayer?.priceRange,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "研究仓位假设",
        current.payload.adviceLayer?.researchPositionRange,
        previous.payload.adviceLayer?.researchPositionRange,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "假设与情景",
        [current.payload.adviceLayer?.assumptions, current.payload.adviceLayer?.scenarios],
        [previous.payload.adviceLayer?.assumptions, previous.payload.adviceLayer?.scenarios],
        isEmpty: researchSectionCompositeIsEmpty
    )
    comparison.append(
        "下一问题",
        current.payload.adviceLayer?.nextQuestion,
        previous.payload.adviceLayer?.nextQuestion,
        isEmpty: researchSectionTextIsEmpty
    )
    comparison.append(
        "材料事实",
        current.payload.researchLayer?.fundamentals,
        previous.payload.researchLayer?.fundamentals,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "研究上下文",
        current.payload.researchLayer?.context,
        previous.payload.researchLayer?.context,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "经营监控",
        current.payload.researchLayer?.operatingMonitor,
        previous.payload.researchLayer?.operatingMonitor,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "估值与技术事实",
        [current.payload.researchLayer?.valuation, current.payload.researchLayer?.technical],
        [previous.payload.researchLayer?.valuation, previous.payload.researchLayer?.technical],
        isEmpty: researchSectionCompositeIsEmpty
    )
    comparison.append(
        "量化与组合风险",
        current.payload.researchLayer?.quantPortfolio,
        previous.payload.researchLayer?.quantPortfolio,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "事件与催化",
        current.payload.researchLayer?.eventsAndCatalysts,
        previous.payload.researchLayer?.eventsAndCatalysts,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "风险",
        current.payload.researchLayer?.risks,
        previous.payload.researchLayer?.risks,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "反证",
        current.payload.researchLayer?.counterevidence,
        previous.payload.researchLayer?.counterevidence,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "未知项",
        current.payload.researchLayer?.unknowns,
        previous.payload.researchLayer?.unknowns,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "来源冲突",
        current.payload.researchLayer?.sourceConflicts,
        previous.payload.researchLayer?.sourceConflicts,
        isEmpty: { $0.isEmpty }
    )
    comparison.append(
        "下一验证问题",
        current.payload.researchLayer?.nextValidationQuestions,
        previous.payload.researchLayer?.nextValidationQuestions,
        isEmpty: { $0.isEmpty }
    )
    return comparison
}

/// A section whose text is present but blank records nothing, exactly like a
/// section the report omitted.
private func researchSectionTextIsEmpty(_ value: String) -> Bool {
    value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// A composite section (several sub-values read as one label) records nothing
/// only when every sub-value is missing or empty.
private func researchSectionCompositeIsEmpty<Value: Collection>(_ values: [Value?]) -> Bool {
    values.allSatisfy { $0?.isEmpty ?? true }
}

public extension String {
    var researchInvestorWording: String {
        replacingOccurrences(of: "wait_for_evidence", with: "等待核实")
            .replacingOccurrences(of: "long_term", with: "长期")
            .replacingOccurrences(of: "medium_term", with: "中期")
            .replacingOccurrences(of: "event_driven", with: "事件驱动")
    }
}

/// Orderless section differences between two different companies' reports.
/// Version numbers are never used to imply chronology between companies.
public struct ResearchReportSectionDifferences: Equatable, Sendable {
    public let changedSections: [String]
    /// Sections both reports record the same. Sections neither report records
    /// are never listed here; they are listed in `unrecordedSections` instead.
    public let unchangedSections: [String]
    /// Sections neither report records. Two companies are not "the same"
    /// because both left a section empty, so this is kept apart from
    /// `unchangedSections` and still needs source checking.
    public let unrecordedSections: [String]
    public let comparisonUnavailableReason: String?
}

/// One company's reading of an exact selected report. Every field is taken
/// verbatim from that payload; nothing is converted, ranked or inferred.
public struct ResearchReportReading: Equatable, Sendable {
    public let symbol: String
    public let judgment: String
    public let priceConditions: String
    public let risksAndInvalidation: String
    public let nextValidationAction: String
    public let riskStatements: [String]
    public let unavailableReason: String?
    public let isEvidenceInsufficient: Bool

    public var isIncompatibleFormat: Bool { unavailableReason != nil }
}

/// Aligns two research data cutoffs as instants. A cutoff is a data coverage
/// instant, never an accounting period, and unparseable values stay unavailable.
public struct ResearchCutoffComparison: Equatable, Sendable {
    public enum Alignment: Equatable, Sendable {
        case sameInstant
        case differentInstant
        case unavailable
    }

    public let alignment: Alignment
    public let ownerText: String

    public init(current: String, compared: String) {
        let currentText = current.trimmingCharacters(in: .whitespacesAndNewlines)
        let comparedText = compared.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentInstant = researchCutoffInstant(currentText)
        let comparedInstant = researchCutoffInstant(comparedText)
        if let currentInstant, let comparedInstant, currentInstant == comparedInstant {
            alignment = .sameInstant
            ownerText = "研究资料截止：两侧为同一时刻（不同时区写法视为同一截止点；只表示资料覆盖时点，不是会计期间）。"
        } else if let currentInstant, let comparedInstant {
            alignment = .differentInstant
            ownerText = "研究资料截止不同：当前股票「\(currentText)」· 对比股票「\(comparedText)」（只表示资料覆盖时点，不是会计期间）。"
        } else {
            alignment = .unavailable
            let unusable = [
                currentInstant == nil ? "当前股票「\(currentText.isEmpty ? "缺失" : currentText)」" : nil,
                comparedInstant == nil ? "对比股票「\(comparedText.isEmpty ? "缺失" : comparedText)」" : nil
            ].compactMap { $0 }
            ownerText = "研究资料截止不可用：\(unusable.joined(separator: "、"))无法解析，不能判断两侧是否同一资料截止点（研究截止不是会计期间）。"
        }
    }
}

/// States only what the two selected reports actually say about exposure.
public enum ResearchSharedExposureNote {
    public static func line(_ left: ResearchReportReading, _ right: ResearchReportReading) -> String {
        guard !left.isIncompatibleFormat, !right.isIncompatibleFormat else {
            return "共同暴露需核实：至少一侧报告格式不兼容，没有可比的结构化风险数据；本比较不推断共同暴露或组合集中度。"
        }
        let leftRisks = Set(left.riskStatements)
        let shared = right.riskStatements.filter { leftRisks.contains($0) }
        guard !shared.isEmpty else {
            return "共同暴露需核实：两侧报告没有相同的结构化风险表述（各自风险原文见上），本比较不推断共同暴露或组合集中度。"
        }
        return "两侧报告有 \(shared.count) 条相同的结构化风险表述（原文见上）；表述相同仍不等于已验证的共同暴露，是否同源仍需核实，本比较不推断共同暴露或组合集中度。"
    }
}

public extension TwoLayerReportData {
    /// Orderless comparison used by cross-stock reading. Sections neither
    /// company records are reported separately and never counted as unchanged:
    /// the two reports are not "the same" there, they are both silent.
    func researchSectionDifferences(with other: TwoLayerReportData) -> ResearchReportSectionDifferences {
        guard other.id != id else {
            return ResearchReportSectionDifferences(
                changedSections: [],
                unchangedSections: [],
                unrecordedSections: [],
                comparisonUnavailableReason: "暂不可比较：跨股票比较需要两个不同的报告。"
            )
        }
        let summary = revisionSummary(previous: other)
        guard summary.comparisonUnavailableReason == nil else {
            return ResearchReportSectionDifferences(
                changedSections: [],
                unchangedSections: [],
                unrecordedSections: [],
                comparisonUnavailableReason: summary.comparisonUnavailableReason
            )
        }
        let comparison = researchSectionComparison(current: self, previous: other)
        let unrecorded = Set(comparison.unrecorded)
        return ResearchReportSectionDifferences(
            changedSections: summary.changedSections,
            unchangedSections: summary.unchangedSections.filter { !unrecorded.contains($0) },
            unrecordedSections: comparison.unrecorded,
            comparisonUnavailableReason: nil
        )
    }

    /// Reads judgment, price conditions, risks and the next validation action
    /// from this exact report only.
    func crossStockReading(symbol: String) -> ResearchReportReading {
        let label = researchNonEmpty(symbol) ?? "该股票"
        guard [evidenceBoundReportContractVersion, deepResearchSynthesisReportContractVersion].contains(contractVersion),
              payload.reportContractVersion == contractVersion,
              let advice = payload.adviceLayer,
              let research = payload.researchLayer else {
            return ResearchReportReading(
                symbol: label,
                judgment: "报告格式不兼容：无法读出判断，不能据此认为判断未变。",
                priceConditions: "报告格式不兼容：价格条件、假设与情景不可读，也未做任何换算。",
                risksAndInvalidation: "报告格式不兼容：风险、失效条件与未知项不可读。",
                nextValidationAction: "请先重新读取该股票的当前不可变报告，再进行比较。",
                riskStatements: [],
                unavailableReason: "报告格式不兼容：不能按现有字段做同口径阅读。",
                isEvidenceInsufficient: status == "evidence_insufficient"
            )
        }
        let missingFacts = researchMissingFactStatements(research)
        let riskStatements = research.risks
            .filter { $0.sourceKind != "source_missing" }
            .map { $0.statement.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var judgment = [
            "结论：\(advice.conclusion)",
            "方向（研究表述）：\(researchDirectionWording(advice.direction) ?? "未提供")",
            "置信度：\(advice.confidence)",
            "研究适用期限：\(advice.applicableUntil)（研究有效期，不是财务期间）"
        ]
        if let conflictNote = researchNonEmpty(advice.conflict.description) {
            judgment.append("长短期关系说明：\(conflictNote)")
        }
        let priceConditions = [
            "价格条件：\(researchReadingListText(advice.priceConditions, emptyText: "报告未提供价格条件"))",
            "价格区间：\(researchNonEmpty(advice.priceRange) ?? "报告未提供")",
            "研究仓位假设：\(researchNonEmpty(advice.researchPositionRange) ?? "报告未提供")",
            "假设：\(researchReadingListText(advice.assumptions, emptyText: "报告未提供"))",
            "情景：\(researchReadingListText(advice.scenarios, emptyText: "报告未提供"))",
            "以上为报告原文文字，未换算币种、未做数值比较；各家公司自己的财务期间、指标定义与币种保持独立，本比较不代表跨公司指标可比。"
        ].joined(separator: " · ")
        let invalidation = advice.longTerm.invalidationConditions + advice.mediumShortTerm.invalidationConditions
        let risksAndInvalidation = [
            "风险：\(riskStatements.isEmpty ? "报告未记录风险原文" : riskStatements.joined(separator: "；"))",
            "失效条件：\(researchReadingListText(invalidation, emptyText: "报告未记录失效条件"))",
            "未知项：\(researchReadingListText(missingFacts, emptyText: "报告未记录未知项"))",
            "反证：\(researchReadingListText(research.counterevidence.map(\.statement), emptyText: "报告未记录反证"))"
        ].joined(separator: " · ")
        let question = researchNonEmpty(advice.nextQuestion)
            ?? research.nextValidationQuestions.compactMap(researchNonEmpty).first
        return ResearchReportReading(
            symbol: label,
            judgment: judgment.joined(separator: " · "),
            priceConditions: priceConditions,
            risksAndInvalidation: risksAndInvalidation,
            nextValidationAction: question ?? "报告未提供下一步验证问题，请先核对最新来源。",
            riskStatements: riskStatements,
            unavailableReason: nil,
            isEvidenceInsufficient: status == "evidence_insufficient" || !missingFacts.isEmpty
        )
    }
}

private func researchCutoffInstant(_ value: String) -> Date? {
    guard !value.isEmpty,
          isParseableDateTime(value),
          researchCutoffCalendarDayIsValid(value),
          researchCutoffClockTimeIsValid(value),
          researchCutoffOffsetIsValid(value) else { return nil }
    if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) {
        return date
    }
    return try? Date.ISO8601FormatStyle().parse(value)
}

/// ISO8601 parsing normalizes an impossible calendar day (for example
/// 2026-02-30 becomes 2026-03-02). A cutoff must survive that check, so the
/// day is validated natively before the instant is returned.
private func researchCutoffCalendarDayIsValid(_ value: String) -> Bool {
    let parts = value.prefix(10).split(separator: "-")
    guard parts.count == 3,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
          (1...12).contains(month), day >= 1 else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
    guard let firstOfMonth = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
          let days = calendar.range(of: .day, in: .month, for: firstOfMonth) else { return false }
    return days.contains(day)
}

/// ISO8601 parsing normalizes an impossible clock time as well (for example
/// 2026-07-30T25:00:00Z becomes the next day 01:00). A cutoff must survive
/// that check too, so hour, minute and second are validated natively before
/// the instant is returned; a leap second stays unavailable.
private func researchCutoffClockTimeIsValid(_ value: String) -> Bool {
    guard let separator = value.firstIndex(of: "T") else { return false }
    let clock = value[value.index(after: separator)...].prefix(8)
    let parts = clock.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 3, parts.allSatisfy({ $0.count == 2 }),
          let hour = Int(parts[0]), let minute = Int(parts[1]), let second = Int(parts[2]) else {
        return false
    }
    return hour <= 23 && minute <= 59 && second <= 59
}

/// Match the strict RFC3339 offset accepted by the shared Web contract instead
/// of allowing Foundation to normalize malformed offsets.
private func researchCutoffOffsetIsValid(_ value: String) -> Bool {
    if value.last == "Z" || value.last == "z" { return true }
    let offset = value.suffix(6)
    guard offset.count == 6,
          offset.first == "+" || offset.first == "-",
          offset[offset.index(offset.startIndex, offsetBy: 3)] == ":",
          let hour = Int(offset.dropFirst().prefix(2)),
          let minute = Int(offset.suffix(2)) else { return false }
    return hour <= 23 && minute <= 59
}

/// Established Owner-facing label for a stored direction enum value; the raw
/// enum never reaches concise judgment text.
private func researchDirectionWording(_ direction: String?) -> String? {
    guard let text = researchNonEmpty(direction) else { return nil }
    return DecisionActionIntent(rawValue: text)?.label ?? text.researchInvestorWording
}

/// Unknown items are the report's own unknowns plus every research fact whose
/// source is missing, matching the existing Web report summary.
private func researchMissingFactStatements(_ research: TwoLayerResearch) -> [String] {
    let allFacts = research.fundamentals
        + (research.context ?? [])
        + research.valuation
        + research.technical
        + (research.quantPortfolio ?? [])
        + research.eventsAndCatalysts
        + (research.operatingMonitor ?? [])
        + research.risks
        + research.counterevidence
    let statements = research.unknowns.map(\.statement)
        + allFacts.filter { $0.sourceKind == "source_missing" }.map(\.statement)
    var unique: [String] = []
    for statement in statements.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
    where !statement.isEmpty && !unique.contains(statement) {
        unique.append(statement)
    }
    return unique
}

private func researchNonEmpty(_ value: String?) -> String? {
    guard let value else { return nil }
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
}

private func researchReadingListText(_ values: [String]?, emptyText: String) -> String {
    let cleaned = (values ?? [])
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    return cleaned.isEmpty ? emptyText : cleaned.joined(separator: "、")
}
