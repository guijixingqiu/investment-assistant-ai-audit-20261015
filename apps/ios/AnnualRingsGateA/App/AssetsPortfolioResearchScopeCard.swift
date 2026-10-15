import Foundation
import SwiftUI

struct AssetsPortfolioResearchScopeCard: View {
    let memberships: CandidateMembershipEnvelope?
    let context: PortfolioDecisionContextEnvelope?
    let fallbackSnapshot: AssetsAlphaSnapshot?
    let openResearch: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("资产跟踪")
            InfoBlock(title: "每日跟踪", value: trackingSummary)
                .accessibilityIdentifier("assetsPortfolioTrackingSummary")
            InfoBlock(title: "资产覆盖（仅跟踪关系）", value: coverageSummary)
                .accessibilityIdentifier("assetsPortfolioCoverageSummary")
            Text(assetIdentity)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("assetsPortfolioAssetIdentity")

            if !trackedMemberships.isEmpty {
                Divider()
                ForEach(trackedMemberships) { membership in
                    Button { openResearch(membership.symbol) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(membership.research.name ?? membership.symbol)
                                    .font(OwnerReadingFont.callout.weight(.semibold))
                                Text("\(membership.symbol) · \(researchState(membership)) · \(quoteState(membership))")
                                    .font(OwnerReadingFont.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(OwnerReadingFont.caption.weight(.bold))
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("assetsPortfolioResearch-\(membership.symbol)")
                }
            }

            DisclosureGroup("暂停项与数据说明") {
                VStack(alignment: .leading, spacing: 5) {
                    Text(membershipIdentity)
                    Text(pausedMemberships.isEmpty
                         ? "没有暂停跟踪的股票。"
                         : "已暂停：\(pausedMemberships.map(\.symbol).joined(separator: "、"))。暂停项不进入每日研究。")
                    Text("这里只汇合既有研究清单与资产快照；浏览不会修改资产或创建正式决定。")
                }
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }
        }
        .cardStyle(padding: 12)
        .accessibilityIdentifier("assetsPortfolioResearchScope")
    }

    private var trackedMemberships: [CandidateMembershipData] {
        guard memberships?.status == .available else { return [] }
        return memberships?.memberships.filter { $0.state == .tracked } ?? []
    }

    private var pausedMemberships: [CandidateMembershipData] {
        guard memberships?.status == .available else { return [] }
        return memberships?.memberships.filter { $0.state == .paused } ?? []
    }

    private var trackingSummary: String {
        guard let memberships else { return "正在读取真实研究清单..." }
        guard memberships.status == .available else {
            return memberships.status == .empty
                ? "研究清单为空；尚未建立每日跟踪。"
                : "研究清单当前不可用，不能沿用旧结果。"
        }
        let count = trackedMemberships.count
        return "\(count) 只已加入跟踪；研究是否充分需逐股核对报告。"
    }

    private var coverageSummary: String {
        guard memberships?.status != .unavailable, memberships != nil else {
            return "研究清单不可用，暂不比较跟踪关系。"
        }
        guard let assetSymbols else {
            return "没有可核对的资产快照，暂不比较跟踪关系。"
        }
        if assetSymbols.isEmpty { return "资产快照明确记录零股票持仓。" }
        let tracked = Set(trackedMemberships.map(\.symbol))
        let paused = Set(pausedMemberships.map(\.symbol))
        let covered = assetSymbols.filter(tracked.contains)
        // Paused holds are not "尚未加入跟踪": they are shown as paused elsewhere
        // in this card. Archived holds stay listed because they are no longer
        // continuously tracked either.
        let uncovered = assetSymbols.filter { !tracked.contains($0) && !paused.contains($0) }
        if uncovered.isEmpty {
            return "已加入跟踪 \(covered.count)/\(assetSymbols.count) 只资产股票；这不代表这些股票已有充分研究。"
        }
        return "已加入跟踪 \(covered.count)/\(assetSymbols.count) 只；尚未加入跟踪：\(uncovered.joined(separator: "、"))。加入跟踪不等于研究充分。"
    }

    private var assetSymbols: [String]? {
        if let context = currentContext { return context.positions.map(\.symbol) }
        if let fallbackSnapshot, fallbackSnapshot.isStale() == false {
            return fallbackSnapshot.positions.map(\.symbol)
        }
        return nil
    }

    private var assetIdentity: String {
        if let context = currentContext {
            let date = context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对"
            switch context.status {
            case .available, .zeroPosition:
                return "当前 · \(context.sourceDisplayName) · 截至 \(date)"
            case .partial:
                return "部分可用 · \(context.sourceDisplayName) · 截至 \(date)"
            case .stale:
                return "已过时 · \(context.sourceDisplayName)，仅供回看 · 截至 \(date)"
            case .empty, .conflict, .unauthorized, .unavailable:
                break
            }
        }
        if let fallbackSnapshot {
            let tag = fallbackSnapshot.isStale() == false ? "最近有效（时间新近）" : "已过时"
            return "\(tag) · 非官方\(fallbackSnapshot.source.displayName)快照 · 截至 \(fallbackSnapshot.asOf)"
        }
        if let context {
            let date = context.sourceAsOf ?? context.portfolioAsOf ?? "时间待核对"
            let state = context.status == .stale ? "陈旧" : "不完整"
            return "\(context.sourceDisplayName)\(state) · 未用于当前覆盖计算 · 截至 \(date)"
        }
        return "尚无可核对的资产快照。"
    }

    private var currentContext: PortfolioDecisionContextEnvelope? {
        guard let context,
              context.status == .available || context.status == .zeroPosition else { return nil }
        return context
    }

    private var membershipIdentity: String {
        guard let memberships else { return "研究清单正在读取。" }
        switch memberships.status {
        case .available, .empty:
            return "当前 · 研究清单截至 \(memberships.generatedAt)。"
        case .unavailable:
            return "研究清单当前不可用，旧清单未继续显示。"
        }
    }

    private func researchState(_ membership: CandidateMembershipData) -> String {
        membership.research.status == .available
            ? "已有研究档案，充分性待报告核对"
            : "研究线索，尚未建立档案"
    }

    private func quoteState(_ membership: CandidateMembershipData) -> String {
        switch membership.quote.status {
        case .fresh: "报价新近"
        case .stale: "报价陈旧"
        case .unavailable: "报价待更新"
        }
    }
}
