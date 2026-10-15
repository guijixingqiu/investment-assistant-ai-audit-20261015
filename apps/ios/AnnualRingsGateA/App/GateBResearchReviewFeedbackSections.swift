import SwiftUI

extension GateBResearchScreen {
    func reviewFeedbackCard(_ card: ReviewFeedbackCard) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("复盘提示", systemImage: "text.magnifyingglass")
                    .font(.callout.weight(.semibold))
                Spacer()
                Text(card.state == .ready ? "可复盘" : "暂不可用")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(card.state == .ready ? .green : .secondary)
                    .accessibilityIdentifier("reviewFeedbackCardState")
                    .accessibilityValue(card.state.rawValue)
            }
            Text(card.title)
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("reviewFeedbackCardTitle")
            Text(card.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("reviewFeedbackCardDetail")
            ForEach(card.items) { item in
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: reviewFeedbackKindIcon(item.kind))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(reviewFeedbackKindColor(item.kind))
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(reviewFeedbackKindLabel(item.kind))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("reviewFeedbackItemKind-\(item.kind.rawValue)")
                            .accessibilityValue(item.kind.rawValue)
                        Text(item.title)
                            .font(.caption.weight(.semibold))
                        Text(item.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reviewFeedbackCard")
    }

    private func reviewFeedbackKindLabel(_ kind: ReviewFeedbackKind) -> String {
        switch kind {
        case .reviewRequired: "需要复盘"
        case .contextLimit: "上下文限制"
        case .evidenceConflict: "证据冲突"
        case .evidenceGap: "证据缺口"
        case .historicalConcentration: "历史集中度"
        case .reviewComplete: "复盘完成"
        }
    }

    private func reviewFeedbackKindIcon(_ kind: ReviewFeedbackKind) -> String {
        switch kind {
        case .reviewRequired: "clock.badge.exclamationmark"
        case .contextLimit: "lock.trianglebadge.exclamationmark"
        case .evidenceConflict: "arrow.left.arrow.right"
        case .evidenceGap: "doc.badge.ellipsis"
        case .historicalConcentration: "chart.pie"
        case .reviewComplete: "checkmark.circle"
        }
    }

    private func reviewFeedbackKindColor(_ kind: ReviewFeedbackKind) -> Color {
        switch kind {
        case .reviewComplete: .green
        case .evidenceConflict, .reviewRequired: .orange
        case .contextLimit: .red
        case .evidenceGap, .historicalConcentration: .blue
        }
    }
}
