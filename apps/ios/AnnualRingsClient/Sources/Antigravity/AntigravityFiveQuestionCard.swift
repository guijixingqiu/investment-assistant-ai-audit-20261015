import SwiftUI

struct AntigravityFiveQuestionCard: View {
    public let dossier: InvestmentDecisionDossier
    public let quote: StockQuote?
    public var onSelect: (() -> Void)? = nil
    
    init(dossier: InvestmentDecisionDossier, quote: StockQuote?, onSelect: (() -> Void)? = nil) {
        self.dossier = dossier
        self.quote = quote
        self.onSelect = onSelect
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header: Symbol, Name, Price, Status
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(dossier.symbol)
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.gold)
                        Text(dossier.name)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                    }
                    Text(dossier.judgmentTitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let q = quote {
                        Text(String(format: "%.2f", q.price))
                            .font(.system(size: 20, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.textPrimary)
                        Text(templateNumber(q.changePercent, format: "%+.2f%%"))
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundColor(q.isPositive ? Theme.green : Theme.red)
                    } else {
                        Text(templateNumber(dossier.currentPrice, format: "%.2f"))
                            .font(.system(size: 20, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.textPrimary)
                        Text("涨跌未返回")
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.red)
                    }
                }
            }
            
            Divider().background(Theme.border)
            
            // 1. 当前判断
            questionRow(
                index: "1",
                label: "当前判断",
                badge: dossier.stance,
                badgeColor: Theme.gold,
                detail: dossier.thesisSummary
            )
            
            // 2. 发生了什么
            questionRow(
                index: "2",
                label: "发生了什么",
                badge: "最新动向",
                badgeColor: Theme.blue,
                detail: dossier.latestCatalysts.first ?? "尚未记录变化"
            )
            
            // 3. 估值与价格条件
            questionRow(
                index: "3",
                label: "估值条件",
                badge: "PE \(templateNumber(dossier.peTtm, format: "%.1f"))x (分位 \(templateNumber(dossier.pePercentile, format: "%.0f"))%)",
                badgeColor: Theme.textSecondary,
                detail: "安全边际 \(templateNumber(dossier.safetyMarginPrice, format: "%.2f")) / 目标 \(templateNumber(dossier.targetPriceBase, format: "%.2f")) 港元"
            )
            
            // 4. 最大风险与失效条件
            questionRow(
                index: "4",
                label: "失效条件",
                badge: "最大回撤 \(dossier.maxDrawdownEst ?? "未估计")",
                badgeColor: Theme.red,
                detail: dossier.invalidationConditions.first ?? "未识别关键失效条件"
            )
            
            // 5. 下一步行动
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text("5")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Theme.bgPrimary)
                        .frame(width: 18, height: 18)
                        .background(Theme.blue)
                        .clipShape(Circle())
                    Text("下一步")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Theme.blue)
                }
                Text(TodayMaterialChangePresentation.localizedResearchTitle(dossier.nextActionTitle))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Theme.textPrimary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Theme.textTertiary)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .templateCardStyle(elevated: true)
        .contentShape(Rectangle())
        .onTapGesture {
            onSelect?()
        }
    }
    
    private func questionRow(index: String, label: String, badge: String, badgeColor: Color, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(index)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Theme.bgPrimary)
                    .frame(width: 16, height: 16)
                    .background(Theme.textSecondary)
                    .clipShape(Circle())
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Theme.textSecondary)
                Text(badge)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(badgeColor)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(badgeColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            Text(detail)
                .font(.system(size: 12.5))
                .foregroundColor(Theme.textPrimary.opacity(0.88))
                .lineLimit(2)
                .padding(.leading, 22)
        }
    }
}
