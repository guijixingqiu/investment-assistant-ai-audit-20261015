import Foundation
import SwiftUI

public struct ResearchMonitorRule: Codable, Equatable, Sendable {
    public let variableName: String
    public let category: String
    public let source: String
    public let cadence: String
    public let threshold: String
    public let reason: String
    public let enabled: Bool
    public let version: Int?
    public let confirmedAt: String?

    public init(
        variableName: String, category: String, source: String, cadence: String,
        threshold: String, reason: String, enabled: Bool,
        version: Int? = nil, confirmedAt: String? = nil
    ) {
        self.variableName = variableName; self.category = category; self.source = source
        self.cadence = cadence; self.threshold = threshold; self.reason = reason; self.enabled = enabled
        self.version = version; self.confirmedAt = confirmedAt
    }

    public func validates(keyVariables: [String]) -> Bool {
        keyVariables.contains(variableName)
            && Self.categories.contains(category) && Self.cadences.contains(cadence)
            && bounded(source, 1_000) && bounded(threshold, 2_000) && bounded(reason, 2_000)
            && ((version == nil && confirmedAt == nil)
                || ((version ?? 0) > 0 && confirmedAt.map(isParseableDateTime) == true))
    }

    public static let categories = [
        "announcement", "financial_report", "corporate_action", "major_news", "price_volume_anomaly",
        "operating_kpi", "industry_chain_price", "competition", "policy", "macro"
    ]
    public static let cadences = ["on_event", "daily", "weekly", "monthly", "quarterly"]

    public static func uniqueNoticeLeadVariable(
        rules: [ResearchMonitorRule],
        allowedVariables: [String],
        category: String? = nil
    ) -> String? {
        uniqueNoticeLeadRule(rules: rules, allowedVariables: allowedVariables, category: category)?.variableName
    }

    public static func uniqueNoticeLeadRule(
        rules: [ResearchMonitorRule],
        allowedVariables: [String],
        category: String? = nil
    ) -> ResearchMonitorRule? {
        let matches = rules.filter {
            $0.enabled && $0.version != nil && $0.confirmedAt != nil
                && allowedVariables.contains($0.variableName)
                && ["announcement", "financial_report", "corporate_action"].contains($0.category)
                && (category == nil || $0.category == category)
        }
        return matches.count == 1 ? matches[0] : nil
    }

    public static func eventKind(forMonitorCategory category: String) -> String {
        ResearchEventCaptureDraft.supportedEventKinds.contains(category) ? category : "news"
    }

    public func binds(eventKind: String, variableName: String) -> Bool {
        enabled && (version ?? 0) > 0 && confirmedAt.map(isParseableDateTime) == true
            && self.variableName == variableName
            && eventKind == Self.eventKind(forMonitorCategory: category)
    }

    static func acceptsCurrentEvidence(
        revisionState: String,
        verificationStatus: String,
        freshness: String
    ) -> Bool {
        revisionState == "current" && verificationStatus == "verified" && freshness == "fresh"
    }
}

public struct ResearchMonitorRuleDraft: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var variableName: String
    public var category: String
    public var source: String
    public var cadence: String
    public var threshold: String
    public var reason: String
    public var enabled: Bool
    public let version: Int?
    public let confirmedAt: String?
    private let originalVariableName: String?

    public init(rule: ResearchMonitorRule) {
        id = UUID(); variableName = rule.variableName; category = rule.category; source = rule.source
        cadence = rule.cadence; threshold = rule.threshold; reason = rule.reason; enabled = rule.enabled
        version = rule.version; confirmedAt = rule.confirmedAt; originalVariableName = rule.variableName
    }

    public init(variableName: String) {
        id = UUID(); self.variableName = variableName; category = "operating_kpi"; source = "发行人正式披露"
        cadence = "monthly"; threshold = "出现足以改变当前假设的重要变化"; reason = "持续核对关键变量"; enabled = true
        version = nil; confirmedAt = nil; originalVariableName = nil
    }

    public func rule(keyVariables: [String]) throws -> ResearchMonitorRule {
        let value = ResearchMonitorRule(
            variableName: variableName, category: category, source: source.trimmingCharacters(in: .whitespacesAndNewlines),
            cadence: cadence, threshold: threshold.trimmingCharacters(in: .whitespacesAndNewlines),
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines), enabled: enabled,
            version: variableName == originalVariableName ? version : nil,
            confirmedAt: variableName == originalVariableName ? confirmedAt : nil
        )
        guard value.validates(keyVariables: keyVariables) else {
            throw AnnualDecisionBriefDraftError.invalid("每条监控规则都必须唯一绑定关键变量，并填写来源、频率、阈值和理由。")
        }
        return value
    }
}

struct ResearchMonitorRulesEditor: View {
    let keyVariables: [String]
    @Binding var rules: [ResearchMonitorRuleDraft]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("正式监控规则").font(.callout.weight(.semibold))
            Text("编辑内容只是提议；保存并重新读取确认后，已启用的公告、财报和公司行动规则才由本地服务定期检查官方来源。事件类别按约六小时轮询，并非实时；其他类别及自由文本来源仍需人工核对。停用也须保存确认。")
                .font(.caption).foregroundStyle(.secondary)
            ForEach($rules) { $rule in
                VStack(alignment: .leading, spacing: 8) {
                    Text(rule.version.map { "正式版本 v\($0) · \(rule.enabled ? "启用" : "已停用") · \(rule.confirmedAt ?? "确认时间不可用")" }
                        ?? "待 Owner 确认的新规则")
                        .font(.caption2).foregroundStyle(rule.version == nil ? Color.orange : Color.secondary)
                    Picker("关键变量", selection: $rule.variableName) {
                        ForEach(keyVariables, id: \.self) { Text($0).tag($0) }
                    }
                    .disabled(rule.version != nil)
                    Picker("监控类别", selection: $rule.category) {
                        ForEach(ResearchMonitorRule.categories, id: \.self) { Text(categoryLabel($0)).tag($0) }
                    }
                    Picker("核对频率", selection: $rule.cadence) {
                        ForEach(ResearchMonitorRule.cadences, id: \.self) { Text(cadenceLabel($0)).tag($0) }
                    }
                    TextField("主要来源", text: $rule.source)
                    TextField("触发阈值", text: $rule.threshold, axis: .vertical)
                    TextField("监控理由", text: $rule.reason, axis: .vertical)
                    Toggle("启用这条规则", isOn: $rule.enabled)
                    Button(rule.version == nil ? "删除未保存规则" : rule.enabled ? "停用规则（保留正式版本）" : "规则已停用（保留正式版本）", role: .destructive) {
                        if rule.version == nil { rules.removeAll { $0.id == rule.id } }
                        else { rule.enabled = false }
                    }
                    .disabled(rule.version != nil && !rule.enabled)
                }
                .padding(10).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            if let variable = keyVariables.first(where: { candidate in !rules.contains { $0.variableName == candidate } }) {
                Button { rules.append(ResearchMonitorRuleDraft(variableName: variable)) } label: {
                    Label("新增监控规则", systemImage: "plus")
                }
                .buttonStyle(.bordered).accessibilityIdentifier("addResearchMonitorRule")
            } else if keyVariables.isEmpty {
                Text("先填写关键变量，才能建立监控规则。").font(.caption).foregroundStyle(.orange)
            }
        }
        .accessibilityElement(children: .contain).accessibilityIdentifier("researchMonitorRulesEditor")
    }
}

struct ResearchMonitorRulesStatus: View {
    let rules: [ResearchMonitorRule]
    let events: [ResearchAnnouncementEventData]
    let materials: [ResearchMaterialData]
    let onCapture: (ResearchMonitorRule) -> Void

    var body: some View {
        if !rules.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("监控规则当前证据").font(.callout.weight(.semibold))
                Text("本地服务运行时按已确认的公告、财报和公司行动规则查找官方资料；其他规则请按清单人工核对。发现线索不等于确认事实或改变判断。")
                    .font(.caption2).foregroundStyle(.secondary)
                ForEach(rules, id: \.variableName) { rule in
                    let event = events.filter { $0.monitorRuleBinding == rule }
                        .max { $0.eventVersion < $1.eventVersion }
                    let material = event.flatMap { current in materials.first { $0.id == current.source.materialId } }
                    let currentMaterial = material.flatMap {
                        ResearchMonitorRule.acceptsCurrentEvidence(
                            revisionState: $0.revisionState,
                            verificationStatus: $0.verificationStatus,
                            freshness: $0.freshness
                        ) ? $0 : nil
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(rule.variableName) · \(rule.version.map { "v\($0)" } ?? "历史版本未记录") · \(rule.enabled ? "启用" : "已停用") · \(cadenceLabel(rule.cadence))")
                            .font(.caption.weight(.semibold))
                        Text(rule.enabled && rule.version != nil && rule.confirmedAt != nil
                             && ["announcement", "financial_report", "corporate_action"].contains(rule.category)
                             ? "本地服务按此类别检查官方来源；资料仍需人工核验。" : "此规则当前由你人工核对来源。")
                            .font(.caption2).foregroundStyle(.secondary)
                        Text(event == nil ? "尚无匹配的已核对事件。" : currentMaterial.map {
                            "最近已核对：\($0.title) · \($0.publishedAt)"
                        } ?? (material == nil
                            ? "匹配事件的材料暂不可用；请重新读取。"
                            : "匹配事件的材料已过期、被替代或不再核验通过；不作为当前证据。"))
                            .font(.caption2).foregroundStyle(.secondary)
                        Text("核对来源：\(rule.source) · 触发阈值：\(rule.threshold) · 监控理由：\(rule.reason)")
                            .font(.caption2).foregroundStyle(.secondary)
                        if rule.enabled {
                            Button(event == nil ? "按此规则录入已核对事件" : "按此规则录入新证据") { onCapture(rule) }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("captureResearchMonitorRule-\(rule.variableName)")
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("researchMonitorRulesStatus")
        }
    }
}

extension AnnualDecisionBriefProfileDraft {
    var normalizedKeyVariables: [String] {
        keyVariables.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

private func bounded(_ value: String, _ max: Int) -> Bool { value == value.trimmingCharacters(in: .whitespacesAndNewlines) && !value.isEmpty && value.count <= max }
private func categoryLabel(_ value: String) -> String { ["announcement":"公告", "financial_report":"财报", "corporate_action":"公司行动", "major_news":"重大新闻", "price_volume_anomaly":"价量异常", "operating_kpi":"经营指标", "industry_chain_price":"产业链价格", "competition":"竞争", "policy":"政策", "macro":"宏观"][value] ?? value }
private func cadenceLabel(_ value: String) -> String { ["on_event":"约每6小时检查新事件", "daily":"每日", "weekly":"每周", "monthly":"每月", "quarterly":"每季度"][value] ?? value }
