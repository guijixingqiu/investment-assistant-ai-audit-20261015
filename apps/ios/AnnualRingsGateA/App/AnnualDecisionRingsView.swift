import SwiftUI

enum DailyDecisionRingLayer: String, CaseIterable, Hashable, Identifiable {
    case candidate
    case evidence
    case portfolio
    case decision
    case review

    var id: String { rawValue }

    var title: String {
        switch self {
        case .candidate: "候选"
        case .evidence: "证据"
        case .portfolio: "组合风险"
        case .decision: "决定"
        case .review: "复盘"
        }
    }

    var systemImage: String {
        switch self {
        case .candidate: "list.bullet.rectangle"
        case .evidence: "doc.text.magnifyingglass"
        case .portfolio: "chart.pie"
        case .decision: "person.crop.circle.badge.checkmark"
        case .review: "clock.arrow.circlepath"
        }
    }

    var tint: Color {
        switch self {
        case .candidate: OwnerExperienceStyle.accent
        case .evidence: OwnerExperienceStyle.success
        case .portfolio: OwnerExperienceStyle.warning
        case .decision: OwnerExperienceStyle.accent
        case .review: .secondary
        }
    }
}

enum OwnerResearchRingState: Equatable {
    case notStarted, inProgress, waitingOwner, recorded, blocked, unavailable, stale

    var title: String {
        switch self {
        case .notStarted: "未开始"
        case .inProgress: "进行中"
        case .waitingOwner: "待我处理"
        case .recorded: "已有完成记录"
        case .blocked: "受阻"
        case .unavailable: "不可用"
        case .stale: "陈旧"
        }
    }

    var systemImage: String {
        switch self {
        case .notStarted: "circle"
        case .inProgress: "clock"
        case .waitingOwner: "person.fill"
        case .recorded: "checkmark.circle.fill"
        case .blocked: "lock.circle.fill"
        case .unavailable: "exclamationmark.triangle.fill"
        case .stale: "clock.arrow.circlepath"
        }
    }

    var tint: Color {
        switch self {
        case .notStarted: .secondary
        case .inProgress: OwnerExperienceStyle.accent
        case .waitingOwner: OwnerExperienceStyle.warning
        case .recorded: OwnerExperienceStyle.success
        case .blocked: OwnerExperienceStyle.warning
        case .unavailable: OwnerExperienceStyle.danger
        case .stale: .orange
        }
    }
}

struct StatusRingsOverview: View {
    let canonicalSymbol: String
    let statusByLayer: [DailyDecisionRingLayer: String]
    let layout: DailyWorkbenchLayoutMetrics
    let selectedLayer: DailyDecisionRingLayer?
    let nextStepLayer: DailyDecisionRingLayer?
    let ringStates: [DailyDecisionRingLayer: OwnerResearchRingState]
    let centerStatus: String?
    let centerNextStep: String?

    init(
        canonicalSymbol: String,
        statusByLayer: [DailyDecisionRingLayer: String] = [:],
        layout: DailyWorkbenchLayoutMetrics = .init(availableWidth: 390, accessibilityText: false),
        selectedLayer: DailyDecisionRingLayer? = nil,
        nextStepLayer: DailyDecisionRingLayer? = nil,
        ringStates: [DailyDecisionRingLayer: OwnerResearchRingState] = [:],
        centerStatus: String? = nil,
        centerNextStep: String? = nil
    ) {
        self.canonicalSymbol = canonicalSymbol
        self.statusByLayer = statusByLayer
        self.layout = layout
        self.selectedLayer = selectedLayer
        self.nextStepLayer = nextStepLayer
        self.ringStates = ringStates
        self.centerStatus = centerStatus
        self.centerNextStep = centerNextStep
    }

    var body: some View {
        VStack(spacing: 10) {
            GeometryReader { proxy in
                let side = min(proxy.size.width, proxy.size.height)
                ZStack {
                    ForEach(Array(DailyDecisionRingLayer.allCases.enumerated()), id: \.element) { index, layer in
                        Circle()
                            .stroke(
                                (ringStates[layer]?.tint ?? layer.tint).opacity(selectedLayer == nil || selectedLayer == layer ? 1 : 0.82),
                                lineWidth: selectedLayer == layer ? 6 : 5
                            )
                            .frame(width: max(72, side - 16 - CGFloat(index) * 44))
                            .accessibilityHidden(true)
                    }
                    ringCenter(side: side)
                    ForEach(Array(DailyDecisionRingLayer.allCases.enumerated()), id: \.element) { index, layer in
                        ringLabel(layer, index: index)
                            .position(labelPosition(index: index, side: side))
                    }
                }
                .frame(width: side, height: side)
                .frame(maxWidth: .infinity)
            }
            .frame(height: layout.ringSide)

            Text(selectedLayer.map { "当前层 · \($0.title)" } ?? "研究状态 · 只读")
                .font(.caption.weight(.semibold))
                .foregroundStyle(selectedLayer?.tint ?? OwnerExperienceStyle.success)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(OwnerExperienceStyle.softBackground, in: Capsule())
                .accessibilityIdentifier("decisionRingSelectedLayer")
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("annualDecisionRings")
        .accessibilityLabel("五项只读状态概览")
        .accessibilityValue(accessibilitySummary)
    }

    @ViewBuilder
    private func ringLabel(_ layer: DailyDecisionRingLayer, index: Int) -> some View {
        if let state = ringStates[layer] {
            VStack(spacing: 2) {
                HStack(spacing: 3) {
                    Image(systemName: state.systemImage).foregroundStyle(state.tint)
                    Text("\(index + 1) \(layer.title)")
                }
                .font(.caption2.weight(selectedLayer == layer ? .semibold : .regular))
                Text(state.title)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(state.tint)
            }
            .foregroundStyle(selectedLayer == layer ? layer.tint : OwnerExperienceStyle.textSecondary)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            .overlay(Capsule().stroke(state.tint.opacity(selectedLayer == layer ? 1 : 0.72), lineWidth: 1))
            .accessibilityIdentifier("decisionRingLayer-\(layer.rawValue)")
            .accessibilityAddTraits(selectedLayer == layer ? .isSelected : [])
        } else {
            Text("\(index + 1) \(layer.title)")
                .font(.caption2.weight(selectedLayer == layer ? .semibold : .regular))
                .foregroundStyle(selectedLayer == layer ? layer.tint : OwnerExperienceStyle.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(.secondarySystemGroupedBackground), in: Capsule())
                .overlay(Capsule().stroke(layer.tint.opacity(selectedLayer == layer ? 1 : 0.72), lineWidth: 1))
                .accessibilityIdentifier("decisionRingLayer-\(layer.rawValue)")
                .accessibilityAddTraits(selectedLayer == layer ? .isSelected : [])
        }
    }

    private func ringCenter(side: CGFloat) -> some View {
        let centerSide = min(layout.ringCenterDiameter, side * 0.32)
        return VStack(spacing: 4) {
            Text(canonicalSymbol)
                .font(.callout.monospaced().weight(.semibold))
                .foregroundStyle(OwnerExperienceStyle.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .accessibilityIdentifier("decisionRingCenterSymbol")
            Text(centerStatus ?? selectedLayer.flatMap { statusByLayer[$0] } ?? "研究中")
                .font(.caption2)
                .foregroundStyle(centerStatus == nil ? OwnerExperienceStyle.success : OwnerExperienceStyle.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let centerNextStep {
                Text("下一步 · \(centerNextStep)")
                    .font(.system(size: 9))
                    .foregroundStyle(OwnerExperienceStyle.textSecondary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(width: centerSide, height: centerSide)
        .background(Color(.secondarySystemGroupedBackground), in: Circle())
        .overlay(Circle().stroke(OwnerExperienceStyle.border, lineWidth: 1.5))
    }

    private func labelPosition(index: Int, side: CGFloat) -> CGPoint {
        switch index {
        case 0: CGPoint(x: side * 0.82, y: side * 0.10)
        case 1: CGPoint(x: side * 0.83, y: side * 0.29)
        case 2: CGPoint(x: side * 0.15, y: side * 0.47)
        case 3: CGPoint(x: side * 0.83, y: side * 0.68)
        default: CGPoint(x: side * 0.76, y: side * 0.85)
        }
    }

    private var accessibilitySummary: String {
        var values = [canonicalSymbol]
        if ringStates.isEmpty {
            values.append(contentsOf: DailyDecisionRingLayer.allCases.map { "\($0.title)：\(statusByLayer[$0] ?? "待查看")" })
        } else {
            values.append(contentsOf: DailyDecisionRingLayer.allCases.map {
                "\($0.title)：\(ringStates[$0]?.title ?? "待查看")，\(statusByLayer[$0] ?? "待查看")"
            })
        }
        if let centerStatus { values.append("研究状态：\(centerStatus)") }
        if let centerNextStep { values.append("下一步：\(centerNextStep)") }
        if let selectedLayer { values.append("当前层：\(selectedLayer.title)") }
        if let nextStepLayer { values.append("唯一下一步：\(nextStepLayer.title)") }
        return values.joined(separator: "，")
    }
}
