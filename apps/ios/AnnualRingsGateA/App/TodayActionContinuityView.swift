import SwiftUI

struct TodayActionContinuityView: View {
    let item: TodayActionInboxItem

    private let stages = ["研究", "报告", "正式决定", "跟踪/复盘"]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("这一步在闭环中的位置")
                .font(.caption.weight(.semibold))
            HStack(spacing: 4) {
                ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
                    Text(stage)
                        .font(.caption2.weight(index == activeStageIndex ? .bold : .regular))
                        .foregroundStyle(index == activeStageIndex ? Color.primary : Color.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .background(
                            index == activeStageIndex
                                ? Color.accentColor.opacity(0.16)
                                : Color(.tertiarySystemGroupedBackground),
                            in: Capsule()
                        )
                    if index < stages.count - 1 {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            Text("完成当前动作后，Today 会重新读取下一步；不会自动确认、正式决定、下单或修改资产。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("todayActionContinuity-\(item.order)")
    }

    private var activeStageIndex: Int {
        switch TodayMaterialChangePresentation.stageLabel(for: item) {
        case "报告": return 1
        case "决定": return 2
        case "跟踪复盘": return 3
        default: return 0
        }
    }
}
