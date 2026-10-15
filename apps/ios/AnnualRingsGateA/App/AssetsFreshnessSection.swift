import SwiftUI

struct AssetsFreshnessSection: View {
    let context: PortfolioDecisionContextEnvelope

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionTitle("来源与新鲜度")
            InfoBlock(title: "状态", value: context.status.userLabel)
            InfoBlock(title: "平安快照新鲜度", value: context.freshness?.state.userLabel ?? "暂无")
            InfoBlock(title: "来源时间", value: context.sourceAsOf ?? "暂无")
            InfoBlock(title: "导入时间", value: context.importedAt ?? "暂无")
            InfoBlock(title: "读取时间", value: context.fetchedAt ?? "暂无")
            InfoBlock(title: "评估时间", value: context.freshness?.evaluatedAt ?? "暂无")
            InfoBlock(title: "年龄 / 阈值", value: ageText)
            InfoBlock(title: "最近交易日收盘", value: context.freshness?.latestSessionClose ?? "暂无")
            InfoBlock(title: "判断", value: context.freshness?.reason.userLabel ?? "暂无")
        }
        .accessibilityIdentifier("assetsFreshnessProvenance")
    }

    private var ageText: String {
        guard let freshness = context.freshness else { return "暂无" }
        return "\(freshness.ageSeconds.formatted()) 秒 / \(freshness.tradingMaxAgeSeconds) 秒"
    }
}

extension PortfolioDecisionContextStatus {
    var userLabel: String {
        switch self {
        case .available: "可用"
        case .stale: "已过时"
        case .partial: "部分可用"
        case .zeroPosition: "零持仓"
        case .empty: "尚无快照"
        case .conflict: "数据冲突"
        case .unauthorized: "未授权"
        case .unavailable: "暂不可用"
        }
    }
}

extension PortfolioDecisionMarketValueStatus {
    var userLabel: String {
        switch self {
        case .completeCurrent: "已计算"
        case .completeStale: "历史值"
        case .partial: "部分缺失"
        case .unavailable: "暂不可用"
        }
    }
}

extension PortfolioDecisionQuoteStatus {
    var userLabel: String {
        switch self {
        case .current: "当前"
        case .stale: "非实时"
        case .unavailable: "暂不可用"
        }
    }
}

func assetsQuoteSourceLabel(_ source: String?) -> String {
    switch source {
    case "futu", "futu_opend": "Futu 行情（只读）"
    case "cache": "本地缓存"
    case nil: "未提供"
    default: source ?? "未提供"
    }
}

func assetsPortfolioSourceLabel(_ source: String?) -> String {
    switch source {
    case "pingan_imported_snapshot": "平安导入快照"
    case nil: "未提供"
    default: "已验证资产快照"
    }
}

func assetsRiskImpactLabel(_ value: String) -> String {
    switch value {
    case "allowed_current_development_only": "可用于当前本地研究"
    case "blocked_stale": "已过时，暂不用于当前判断"
    case "blocked_incomplete": "信息不完整，暂不用于当前判断"
    default: "暂不用于当前判断"
    }
}

private extension PortfolioDecisionFreshnessState {
    var userLabel: String { self == .current ? "当前" : "已过时" }
}

private extension PortfolioDecisionFreshnessReason {
    var userLabel: String {
        switch self {
        case .withinPolicy: "在允许时限内"
        case .tradingAgeExceeded: "超过交易时限"
        case .beforeLatestSessionClose: "早于最近收市"
        case .sourceTimestampInFuture: "来源时间异常"
        }
    }
}
