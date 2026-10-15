import Foundation
import SwiftUI

struct AssetsPortfolioImpactCard: View {
    let selectedSymbol: String
    let memberships: CandidateMembershipEnvelope?
    let workspaces: [String: FrozenResearchEvidenceWorkspace]
    let context: PortfolioDecisionContextEnvelope?
    let fallbackSnapshot: AssetsAlphaSnapshot?
    let openResearch: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("组合影响")
            Text(assetIdentity)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("assetsPortfolioImpactIdentity")
            InfoBlock(title: "暴露", value: exposureSummary)
                .accessibilityIdentifier("assetsPortfolioExposure")
            InfoBlock(title: "集中度", value: concentrationSummary)
                .accessibilityIdentifier("assetsPortfolioConcentration")
            InfoBlock(title: "最大组合风险", value: maximumRiskSummary)
                .accessibilityIdentifier("assetsPortfolioMaximumRisk")
            InfoBlock(title: "共同风险", value: commonRiskSummary)
                .accessibilityIdentifier("assetsPortfolioCommonRisk")
            InfoBlock(title: "情景如何传导", value: scenarioTransmissionSummary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("assetsPortfolioScenarioTransmission")
            InfoBlock(title: "研究机会成本", value: opportunityCostSummary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("assetsPortfolioOpportunityCost")
            Divider()
            Text("研究结论对组合的影响")
                .font(OwnerReadingFont.callout.weight(.semibold))
            if impactRows.isEmpty {
                Text("目前没有可同时绑定到资产股票和已确认研究报告的结果。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(impactRows) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("\(row.symbol) · \(row.weight)")
                            .font(OwnerReadingFont.caption.weight(.semibold))
                        Text(row.conclusion)
                            .font(OwnerReadingFont.caption)
                        Button("打开完整研究") { openResearch(row.symbol) }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("assetsPortfolioImpactResearch-\(row.symbol)")
                    }
                    .ownerSubtleSurface()
                }
            }
            Text("这里只解释现有暴露与已确认判断的关系；不会生成替换建议、目标仓位或资产写入。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assetsPortfolioImpact")
    }

    private struct AssetPosition: Identifiable {
        let symbol: String
        let weight: Double?
        var id: String { symbol }
    }

    private struct ImpactRow: Identifiable {
        let symbol: String
        let weight: String
        let conclusion: String
        var id: String { symbol }
    }

    private var trackedMemberships: [CandidateMembershipData] {
        guard memberships?.status == .available else { return [] }
        return memberships?.memberships.filter { $0.state == .tracked } ?? []
    }

    private var assetPositions: [AssetPosition]? {
        if let context = currentContext {
            return context.positions.map { AssetPosition(symbol: $0.symbol, weight: $0.marketWeight) }
        }
        guard let snapshot = usableFallbackSnapshot else { return nil }
        let total = snapshot.positions.compactMap(\.marketValueHkd).reduce(0, +)
        let complete = snapshot.positions.allSatisfy { $0.marketValueHkd != nil } && total > 0
        return snapshot.positions.map {
            AssetPosition(symbol: $0.symbol, weight: complete ? ($0.marketValueHkd ?? 0) / total : nil)
        }
    }

    private var assetIdentity: String {
        if let context = currentContext {
            let cutoff = context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对"
            switch context.status {
            case .available, .zeroPosition: return "当前 · \(context.sourceDisplayName) · 截至 \(cutoff)"
            case .partial: return "部分可用 · \(context.sourceDisplayName) · 截至 \(cutoff)"
            case .stale: return "已过时 · \(context.sourceDisplayName)，仅供回看 · 截至 \(cutoff)"
            case .empty, .conflict, .unauthorized, .unavailable: break
            }
        }
        if let snapshot = fallbackSnapshot {
            let tag = snapshot.isStale() == false ? "最近有效（时间新近）" : "已过时"
            return "\(tag) · 非官方\(snapshot.source.displayName)快照 · 截至 \(snapshot.asOf)"
        }
        if let context {
            let cutoff = context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对"
            let state = context.status == .stale ? "陈旧" : "不完整"
            return "\(context.sourceDisplayName)\(state) · 未用于当前组合计算 · 截至 \(cutoff)"
        }
        return "尚无可核对的资产快照。"
    }

    private var currentContext: PortfolioDecisionContextEnvelope? {
        guard let context,
              context.status == .available || context.status == .zeroPosition else { return nil }
        return context
    }

    private var usableFallbackSnapshot: AssetsAlphaSnapshot? {
        guard let fallbackSnapshot, fallbackSnapshot.isStale() == false else { return nil }
        return fallbackSnapshot
    }

    private var exposureSummary: String {
        guard let positions = assetPositions else { return "没有可核对的资产股票。" }
        if positions.isEmpty { return "资产快照明确记录零股票持仓。" }
        let covered = positions.filter { confirmedReport(symbol: $0.symbol) != nil }.count
        let values = positions.map { "\($0.symbol) \(percent($0.weight))" }.joined(separator: " · ")
        return "\(positions.count) 只股票；\(covered) 只已有确认研究。\n\(values)"
    }

    private var concentrationSummary: String {
        if let context = currentContext {
            guard context.summary.concentration.status == .available else {
                return "当前快照不足以计算集中度；暂不下结论。"
            }
            let value = context.summary.concentration
            return "最大 \(percent(value.largestPositionWeight)) · 前三 \(percent(value.topThreeWeight)) · 集中度指数 \(number(value.hhi))"
        }
        guard let positions = assetPositions, !positions.isEmpty,
              positions.allSatisfy({ $0.weight != nil }) else {
            return "非官方快照未补齐全部股票市值；暂不计算集中度。"
        }
        let sorted = positions.compactMap(\.weight).sorted(by: >)
        let topThree = sorted.prefix(3).reduce(0, +)
        let hhi = sorted.reduce(0) { $0 + $1 * $1 }
        return "最大 \(percent(sorted.first)) · 前三 \(percent(topThree)) · 集中度指数 \(number(hhi)) · 非官方"
    }

    private var maximumRiskSummary: String {
        guard let positions = assetPositions, !positions.isEmpty else {
            return assetPositions == nil ? "没有可核对的当前组合。" : "股票持仓为 0；现金和其他资产风险仍待来源确认。"
        }
        guard let largest = positions.compactMap({ position in position.weight.map { (position.symbol, $0) } }).max(by: { $0.1 < $1.1 }) else {
            return "没有完整权重，不能识别最大股票暴露。"
        }
        let largestSymbol = largest.0
        let largestWeight = largest.1
        return "目前可识别的最大组合风险是集中度：\(largestSymbol) 占已知股票市值 \(percent(largestWeight))；不等于该股票一定下跌。"
    }

    private var commonRiskSummary: String {
        let reports = trackedMemberships.compactMap { membership in
            confirmedReport(membership: membership).map { (membership, $0) }
        }
        let currentReports = reports.filter { !reportIsStale($0.1, membership: $0.0) }
        guard currentReports.count >= 2 else {
            return "至少需要两只当前有效的已确认研究判断，才能比较共同风险。"
        }
        var occurrences: [String: (text: String, symbols: [String])] = [:]
        for (membership, report) in currentReports {
            for risk in reportRisks(report).prefix(3) {
                let key = risk.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                guard !key.isEmpty else { continue }
                var entry = occurrences[key] ?? (risk, [])
                entry.symbols.append(membership.symbol)
                occurrences[key] = entry
            }
        }
        guard let repeated = occurrences.values
            .filter({ Set($0.symbols).count >= 2 })
            .max(by: { Set($0.symbols).count < Set($1.symbols).count }) else {
            return "当前可用研究判断没有文字完全一致的共同风险；这不代表组合不存在相关性风险。"
        }
        return "\(Set(repeated.symbols).sorted().joined(separator: "、"))：\(repeated.text)"
    }

    private var opportunityCostSummary: String {
        guard let memberships else {
            return "研究清单正在读取；暂不安排 \(selectedSymbol) 的组合研究优先级。"
        }
        guard memberships.status == .available else {
            return "研究清单暂不可用；暂不安排 \(selectedSymbol) 的组合研究优先级。"
        }
        guard let selectedMembership = trackedMemberships.first(where: { $0.symbol == selectedSymbol }) else {
            return "\(selectedSymbol) 尚未进入每日研究范围，不能安排组合研究优先级。"
        }
        let selectedReport = confirmedReport(membership: selectedMembership)
        let selectedReportIsStale = selectedReport.map { reportIsStale($0, membership: selectedMembership) } ?? true
        let observation = selectedReport
            .flatMap { report in
                report.payload.adviceLayer?.nextQuestion
                    ?? report.payload.researchLayer?.nextValidationQuestions.first
            }
            .flatMap(nonEmpty)
            ?? "该股票没有明确的下一观察问题。"
        let weights = Dictionary(uniqueKeysWithValues: (assetPositions ?? []).map { ($0.symbol, $0.weight) })
        let deferred = trackedMemberships
            .filter { $0.symbol != selectedSymbol }
            .sorted {
                (weights[$0.symbol] ?? nil) ?? -1 > (weights[$1.symbol] ?? nil) ?? -1
            }
        guard !deferred.isEmpty else {
            let lead = selectedReportIsStale ? "先复核 \(selectedSymbol) 的历史判断" : "当前先研究 \(selectedSymbol)"
            return "\(lead)：\(observation)\n没有其他每日跟踪股票可暂缓；暂不比较研究机会成本。"
        }
        let deferredText = deferred.map {
            "\($0.symbol)（暴露 \(percent(weights[$0.symbol] ?? nil))）"
        }.joined(separator: "、")
        let lead = selectedReportIsStale ? "先复核 \(selectedSymbol) 的历史判断" : "当前先研究 \(selectedSymbol)"
        return "\(lead)：\(observation)\n暂缓 \(deferredText)。代价是这些股票的新变化会稍后复核；这里只安排研究时间，不比较预期收益，也不推导替换或仓位。"
    }

    private var scenarioTransmissionSummary: String {
        guard let selectedMembership = trackedMemberships.first(where: { $0.symbol == selectedSymbol }),
              let report = confirmedReport(membership: selectedMembership),
              let advice = report.payload.adviceLayer else {
            return "\(selectedSymbol) 没有可绑定的已确认研究判断，不能解释情景传导。"
        }
        let worsening = (advice.mediumShortTerm.invalidationConditions
            + advice.longTerm.invalidationConditions
            + report.payload.invalidationConditions)
            .compactMap(nonEmpty)
            .first?
            .researchBriefOwnerCondition(
                replacement: "关键材料、估值或技术依据发生变化，或主要经营风险恶化。"
            )
            ?? "报告没有可核验的恶化条件。"
        let exposure = assetPositions?.first(where: { $0.symbol == selectedSymbol })
        let exposureText: String
        if assetPositions == nil {
            exposureText = "没有可核对的当前资产股票。"
        } else if let exposure {
            exposureText = "现有已知暴露 \(percent(exposure.weight))。"
        } else {
            exposureText = "资产快照没有该股票记录；不能推断为零持仓或无影响。"
        }
        let concentrationText: String
        if let positions = assetPositions,
           let largest = positions.compactMap({ position in
               position.weight.map { (position.symbol, $0) }
           }).max(by: { $0.1 < $1.1 }), largest.0 == selectedSymbol {
            concentrationText = "该股票也是最大已知暴露，恶化时应先复核集中度风险。"
        } else {
            concentrationText = "现有集中度不会因研究情景自动重算；等待新资产事实后再比较。"
        }
        let reportState = reportIsStale(report, membership: selectedMembership) ? "历史确认判断" : "当前确认判断"
        return "\(reportState)的恶化条件：\(worsening)\n\(exposureText) \(concentrationText)\n共同风险：\(commonRiskSummary)\n没有新快照前，不推断金额或权重变化。"
    }

    private var impactRows: [ImpactRow] {
        guard let positions = assetPositions else { return [] }
        return positions.compactMap { position in
            guard let membership = trackedMemberships.first(where: { $0.symbol == position.symbol }),
                  let report = confirmedReport(membership: membership) else { return nil }
            let conclusion = report.payload.adviceLayer?.conclusion ?? report.payload.investmentThesis
            guard !conclusion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            let displayedConclusion = reportIsStale(report, membership: membership)
                ? "历史研究结果（已过适用期）：\(conclusion)"
                : conclusion
            return ImpactRow(symbol: position.symbol, weight: percent(position.weight), conclusion: displayedConclusion)
        }
    }

    private func reportIsStale(_ report: TwoLayerReportData, membership: CandidateMembershipData) -> Bool {
        guard let workspace = workspaces[membership.id],
              workspace.isFreshForCurrentResearch,
              report.isCurrentExact else { return true }
        guard let value = report.payload.adviceLayer?.applicableUntil,
              let applicableUntil = parseInstant(value) else { return true }
        return applicableUntil <= Date()
    }

    private func confirmedReport(symbol: String) -> TwoLayerReportData? {
        guard let membership = trackedMemberships.first(where: { $0.symbol == symbol }) else { return nil }
        return confirmedReport(membership: membership)
    }

    private func confirmedReport(membership: CandidateMembershipData) -> TwoLayerReportData? {
        guard let workspace = workspaces[membership.id],
              workspace.data?.target.membershipId == membership.id,
              workspace.data?.target.membershipVersion == membership.version,
              workspace.data?.target.symbol == membership.symbol,
              workspace.isFreshForCurrentResearch
                || (workspace.metadata.freshness == "stale"
                    && workspace.metadata.stale
                    && !workspace.metadata.missing
                    && !workspace.metadata.conflict),
              let data = workspace.data else { return nil }
        let confirmedIds = Set(data.decisions.filter { $0.decision == "confirmed" }.map(\.reportId))
        let confirmed = data.reports
            .filter { confirmedIds.contains($0.id) }
            .sorted { $0.version > $1.version }
        return confirmed.first(where: { $0.payload.adviceLayer != nil }) ?? confirmed.first
    }

    private func reportRisks(_ report: TwoLayerReportData) -> [String] {
        let advice = report.payload.adviceLayer
        let research = report.payload.researchLayer
        return (research?.risks
            .filter { $0.sourceKind != "source_missing" }
            .map(\.statement) ?? [])
            + (advice?.mediumShortTerm.risks ?? [])
            + (advice?.longTerm.risks ?? [])
    }

    private func percent(_ value: Double?) -> String {
        value?.formatted(.percent.precision(.fractionLength(2))) ?? "待补齐"
    }

    private func number(_ value: Double?) -> String {
        value?.formatted(.number.precision(.fractionLength(0 ... 4))) ?? "待补齐"
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
